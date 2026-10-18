/**
 * dsh-screenshot — Host 半侧
 * ---------------------------------------------------------------------------
 * 提供三个路由：
 *   GET  /dsh-shot/ping     探活（返回版本号，便于安装后自检）
 *   POST /dsh-shot/capture  启动自带的原生截图小工具，等用户拖选/确认后返回 PNG
 *   POST /dsh-shot/cancel   结束正在等待的截图
 *
 * 截图不再调用 Windows 的 ms-screenclip:（冷启动要 2-3 秒），改用随插件附带的
 * lib/ShotHelper.cs 编译出的 dsh-shot-helper.exe：
 *   冻结全屏 → 拖选 → 手柄调整 → 回车/✓ 确认 → 直接写出 PNG 并退出。
 * 首次使用时用系统自带的 csc.exe 编译（约 1 秒），之后每次启动约 0.3-0.5 秒。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_FILE = path.join(PACKAGE_ROOT, 'lib', 'ShotHelper.cs')
const HELPER_FILE = path.join(PACKAGE_ROOT, 'lib', 'dsh-shot-helper.exe')
const ROUTE_BASE = '/dsh-shot'
const NS = 'dsh-screenshot'
const CAPTURE_TIMEOUT_SEC = 180

/** 插件版本：读自己的 package.json。 */
const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    return String(pkg.version || '0.0.0')
  } catch {
    return '0.0.0'
  }
})()

export const name = NS
export const inject = ['webServer', 'connection']

/** 找系统自带的 C# 编译器（.NET Framework 4.x）。 */
function findCsc() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const candidates = [
    path.join(root, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(root, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      /* 继续找 */
    }
  }
  return null
}

/** 跑一个短命进程并收集输出。 */
function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error((stderr || stdout || `exit ${String(code)}`).trim().slice(0, 600)))
    })
  })
}

/** 首次使用/源码更新后编译原生小工具；之后直接复用 exe。 */
let helperPromise = null
function ensureHelper() {
  // exe 被清理掉时（例如手动删除/杀软隔离）重新编译，而不是一直返回缓存路径。
  if (helperPromise !== null && !fs.existsSync(HELPER_FILE)) helperPromise = null
  if (helperPromise !== null) return helperPromise
  helperPromise = (async () => {
    try {
      const helper = fs.statSync(HELPER_FILE)
      const source = fs.statSync(SOURCE_FILE)
      if (helper.mtimeMs >= source.mtimeMs) return HELPER_FILE
    } catch {
      /* 需要编译 */
    }
    const csc = findCsc()
    if (csc === null) {
      throw new Error('找不到 csc.exe（需要 Windows 自带的 .NET Framework 4.x）')
    }
    const temp = HELPER_FILE + '.' + process.pid + '.tmp.exe'
    try {
      await runProcess(csc, [
        '/nologo',
        '/target:winexe',
        '/optimize+',
        '/out:' + temp,
        SOURCE_FILE,
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll'
      ])
      fs.renameSync(temp, HELPER_FILE)
    } finally {
      try { fs.rmSync(temp, { force: true }) } catch { /* 忽略 */ }
    }
    return HELPER_FILE
  })().catch((error) => {
    helperPromise = null
    throw error
  })
  return helperPromise
}

/**
 * 结束进程树：只杀父进程可能留下还在等选区的子进程，
 * 让下一次截图继续撞“上一次还没结束”。
 * @param {import('node:child_process').ChildProcess | null} child
 */
function killProcessTree(child) {
  if (child === null || child === undefined) return
  if (child.killed || child.exitCode !== null) return
  try {
    if (process.platform === 'win32' && typeof child.pid === 'number') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.once('error', () => {})
      killer.unref()
      return
    }
    child.kill('SIGKILL')
  } catch {
    try { child.kill() } catch { /* 已经退出 */ }
  }
}

/**
 * 启动原生截图工具，等它写出 PNG。
 * @param {string} outPath - PNG 输出路径。
 * @param {AbortSignal} signal - 取消信号。
 * @param {(child: import('node:child_process').ChildProcess) => void} onChild - 子进程句柄。
 * @returns {Promise<Buffer>}
 */
function runCapture(outPath, signal, onChild, hideApp) {
  return new Promise((resolve, reject) => {
    let child
    try {
      const args = ['--out', outPath]
      if (hideApp) args.push('--hide-dsh')
      child = spawn(HELPER_FILE, args, {
        windowsHide: false,
        stdio: 'ignore'
      })
    } catch (error) {
      reject(error)
      return
    }
    try { onChild?.(child) } catch { /* 忽略 */ }

    let settled = false
    let timer
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }

    timer = setTimeout(() => {
      killProcessTree(child)
      finish(reject, new Error('截图超时（没有等到选区完成）'))
    }, CAPTURE_TIMEOUT_SEC * 1000)

    if (signal) {
      if (signal.aborted) {
        killProcessTree(child)
        finish(reject, new Error('已取消'))
        return
      }
      signal.addEventListener('abort', () => {
        killProcessTree(child)
        finish(reject, new Error('已取消'))
      }, { once: true })
    }

    child.once('error', (error) => finish(reject, error))
    child.once('exit', (code) => {
      if (code === 0) {
        try {
          finish(resolve, fs.readFileSync(outPath))
        } catch (error) {
          finish(reject, new Error('截图文件读取失败：' + error.message))
        }
        return
      }
      if (code === 2) finish(reject, new Error('已取消'))
      else finish(reject, new Error(`截图工具退出（code ${String(code)}）`))
    })
  })
}

/**
 * 注册路由。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const logger = (() => {
    try {
      return ctx.logger(NS)
    } catch {
      return undefined
    }
  })()

  const webServer = ctx.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    logger?.warn?.('[dsh-screenshot] 当前 profile 没有可用的 webServer，截屏路由未注册。')
    return
  }

  /** @type {{ controller: AbortController, child: import('node:child_process').ChildProcess | null, startedAt: number, cancelled: boolean } | null} */
  let active = null
  const tempDir = path.join(os.tmpdir(), 'dsh-screenshot')
  try {
    fs.mkdirSync(tempDir, { recursive: true })
  } catch {
    /* 交给 capture 阶段报错 */
  }

  /** 强杀 helper 后把被隐藏的 DSH 窗口恢复出来（helper 自己正常退出时会恢复）。 */
  function restoreDsh() {
    try {
      if (!fs.existsSync(HELPER_FILE)) return
      const child = spawn(HELPER_FILE, ['--restore'], { windowsHide: true, stdio: 'ignore' })
      child.once('error', () => {})
      child.unref()
    } catch {
      /* 忽略 */
    }
  }

  function cancelActive() {
    const current = active
    if (current === null) return false
    active = null
    current.cancelled = true
    try { current.controller.abort() } catch { /* 忽略 */ }
    killProcessTree(current.child)
    if (current.hideApp) restoreDsh()
    return true
  }

  function rejected(req, res) {
    try {
      const conn = ctx.connection || (typeof ctx.get === 'function' ? ctx.get('connection') : undefined)
      if (!conn || typeof conn.requestRejection !== 'function') return false
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch {
      return false
    }
  }

  function sendJson(res, code, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    try {
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': String(body.length)
      })
      res.end(body)
    } catch {
      /* 客户端已断开 */
    }
  }

  function register(route) {
    const inner = route.handler
    return webServer.register({
      ...route,
      handler: (req, res) => {
        if (rejected(req, res)) return
        return inner(req, res)
      }
    })
  }

  async function capture(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (active !== null && Date.now() - active.startedAt > (CAPTURE_TIMEOUT_SEC + 20) * 1000) {
      cancelActive()
    }
    if (active !== null) {
      sendJson(res, 409, { ok: false, error: 'busy', message: '上一次截屏还没结束' })
      return
    }

    const controller = new AbortController()
    let hideApp = false
    try {
      hideApp = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('hideApp') === '1'
    } catch {
      hideApp = false
    }
    const entry = { controller, child: null, startedAt: Date.now(), cancelled: false, hideApp }
    active = entry
    const file = path.join(tempDir, `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)

    const disconnect = () => {
      if (!res.writableEnded && active === entry) cancelActive()
    }
    res.on('close', disconnect)

    try {
      await ensureHelper()
      if (entry.cancelled) {
        try { if (!res.writableEnded && !res.destroyed) res.end() } catch { /* 忽略 */ }
        return
      }
      const bytes = await runCapture(file, controller.signal, (child) => { entry.child = child }, hideApp)
      if (res.writableEnded || res.destroyed) return
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Length': String(bytes.length)
      })
      res.end(bytes)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (entry.cancelled) {
        try { if (!res.writableEnded && !res.destroyed) res.end() } catch { /* 忽略 */ }
      } else if (!res.writableEnded && !res.destroyed) {
        const timeout = /超时/.test(message)
        sendJson(res, timeout ? 504 : 500, { ok: false, error: message })
        if (!timeout) logger?.warn?.('[dsh-screenshot] ' + message)
      }
    } finally {
      if (active === entry) active = null
      res.removeListener('close', disconnect)
      try { fs.rmSync(file, { force: true }) } catch { /* 忽略 */ }
    }
  }

  function cancel(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    sendJson(res, 200, { ok: true, cancelled: cancelActive() })
  }

  const disposers = []

  disposers.push(register({
    kind: 'exact',
    path: ROUTE_BASE + '/ping',
    handler: (req, res) => {
      sendJson(res, 200, {
        ok: true,
        name: NS,
        version: PLUGIN_VERSION,
        platform: process.platform,
        helper: HELPER_FILE,
        helperBuilt: fs.existsSync(HELPER_FILE),
        compiler: findCsc()
      })
    }
  }))

  disposers.push(register({ kind: 'exact', path: ROUTE_BASE + '/capture', handler: capture }))
  disposers.push(register({ kind: 'exact', path: ROUTE_BASE + '/cancel', handler: cancel }))

  ctx.effect(() => () => {
    cancelActive()
    for (const dispose of disposers) {
      try { dispose() } catch { /* 忽略 */ }
    }
  })

  logger?.info?.(`[dsh-screenshot] routes ready: ${ROUTE_BASE}/capture (v${PLUGIN_VERSION})`)
}
