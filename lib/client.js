/**
 * dsh-screenshot — 浏览器半侧（手写 ModuleLoader bundle，无需构建）
 * ---------------------------------------------------------------------------
 * 在输入框右侧加一个相机按钮：注册到列表座位 `conversation.input.right`，
 * 视觉上排在模型选择器之后、发送按钮之前（与语音输入的 activity 单座位互不影响）。
 *   点击 → POST /dsh-shot/capture → Host 调起 Windows 自带截图浮层 →
 *   用户选完区域 → 返回 PNG → 作为图片附件放进当前会话的草稿框。
 *
 * 附件插入走官方 ComposerAttachments 已经在 document 上监听的 drop 通道
 * （和把图片拖进输入框是同一条路径），不碰任何内部 store；drop 没生效时
 * 再退回“粘贴图片”通道。
 */

window.__ModuleLoader__.load({
  id: 'dsh-screenshot',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement

    var CSS = [
      '.dshs-shot{width:28px;height:28px;flex:none;display:grid;place-items:center;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s ease,color .15s ease;order:1}',
      '.dshs-shot:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshs-shot:active:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}',
      '.dshs-shot:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.dshs-shot:disabled{opacity:.45;cursor:default}',
      '.dshs-shot[data-active="true"]{color:#07c160}',
      '.dshs-shot[data-active="true"]:hover:not(:disabled){background:rgba(7,193,96,.12);color:#07c160}',
      '.dshs-shot[data-busy="true"] .dshs-camera{display:none}',
      '.dshs-spinner{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-top-color:var(--dsw-alias-state-business-primary,#4d6bfe);animation:dshs-rotate .75s linear infinite}',
      '@keyframes dshs-rotate{to{transform:rotate(360deg)}}',
      '.dshs-toast{position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:9999;max-width:min(78vw,520px);padding:8px 14px;border-radius:10px;background:var(--dsw-specific-menu,rgba(32,33,36,.96));color:var(--dsw-alias-label-primary,#fff);border:.5px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));box-shadow:0 8px 28px rgba(0,0,0,.28);font-size:12px;line-height:18px;text-align:center;pointer-events:none;animation:dshs-in .16s ease-out}',
      '.dshs-toast[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#ff6b6b)}',
      '@keyframes dshs-in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}',
      '@media (prefers-reduced-motion:reduce){.dshs-spinner{animation-duration:2s}.dshs-toast{animation:none}}'
    ].join('')

    var STYLE_ID = 'dsh-screenshot/style'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
      var style = document.createElement('style')
      style.dataset.plugin = 'dsh-screenshot'
      style.dataset.pluginCss = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /** 底部居中提示条；同一时间只保留一条。 */
    var toastTimer = 0
    var toastNode = null

    function clearToast() {
      if (toastTimer) {
        clearTimeout(toastTimer)
        toastTimer = 0
      }
      if (toastNode && toastNode.parentNode) toastNode.parentNode.removeChild(toastNode)
      toastNode = null
    }

    function showToast(text, tone, ms) {
      try {
        clearToast()
        var node = document.createElement('div')
        node.className = 'dshs-toast'
        node.setAttribute('role', tone === 'error' ? 'alert' : 'status')
        if (tone) node.dataset.tone = tone
        node.textContent = text
        document.body.appendChild(node)
        toastNode = node
        toastTimer = setTimeout(clearToast, typeof ms === 'number' ? ms : 2600)
      } catch {
        /* 提示失败不影响主流程 */
      }
    }

    /** 统计所有草稿框里的图片缩略图数量，用来判断附件是否真的进去了。 */
    function composerImageCount() {
      var cards = document.querySelectorAll('[data-composer-card]')
      var count = 0
      for (var i = 0; i < cards.length; i++) count += cards[i].querySelectorAll('img').length
      return count
    }

    function makeTransfer(file) {
      var transfer = new DataTransfer()
      transfer.items.add(file)
      return transfer
    }

    /** 等 React 把附件缩略图渲染出来（dispatch 是同步的，DOM 更新不是）。 */
    function waitForComposerImage(before, timeoutMs) {
      var deadline = Date.now() + (typeof timeoutMs === 'number' ? timeoutMs : 700)
      return new Promise(function (resolve) {
        var tick = function () {
          if (composerImageCount() > before) {
            resolve(true)
            return
          }
          if (Date.now() >= deadline) {
            resolve(false)
            return
          }
          setTimeout(tick, 50)
        }
        tick()
      })
    }

    /**
     * 走官方附件通道插入图片：优先模拟 drop（document 级监听，不依赖焦点），
     * 没生效再退回向编辑器粘贴。只用一个通道成功，避免同一张图被插两次。
     * @returns {Promise<boolean>} 是否成功插入
     */
    async function insertImage(file) {
      var card = document.querySelector('[data-composer-card]')
      var before = composerImageCount()

      if (card) {
        try {
          var drop
          var init = { bubbles: true, cancelable: true, dataTransfer: makeTransfer(file) }
          try {
            drop = new DragEvent('drop', init)
          } catch {
            drop = new Event('drop', { bubbles: true, cancelable: true })
            Object.defineProperty(drop, 'dataTransfer', { value: init.dataTransfer })
          }
          card.dispatchEvent(drop)
          if (await waitForComposerImage(before, 700)) return true
        } catch {
          /* 换粘贴 */
        }
      }

      try {
        var editor = document.querySelector('[data-composer-card] [contenteditable="true"]')
        if (editor) {
          editor.focus()
          var paste
          var pasteInit = { bubbles: true, cancelable: true, clipboardData: makeTransfer(file) }
          try {
            paste = new ClipboardEvent('paste', pasteInit)
          } catch {
            paste = new Event('paste', { bubbles: true, cancelable: true })
            Object.defineProperty(paste, 'clipboardData', { value: pasteInit.clipboardData })
          }
          editor.dispatchEvent(paste)
        }
      } catch {
        /* 两种通道都失败，下面按计数判断 */
      }

      return await waitForComposerImage(before, 700)
    }

    /** 截图可能很大：超过 2000px 或 3.2MB 时等比缩到 2000px 再转 PNG。 */
    async function normalize(blob) {
      var MAX_EDGE = 2000
      var MAX_BYTES = 3.2 * 1024 * 1024
      try {
        if (typeof createImageBitmap !== 'function') return blob
        var bitmap = await createImageBitmap(blob)
        var edge = Math.max(bitmap.width, bitmap.height)
        if (edge <= MAX_EDGE && blob.size <= MAX_BYTES) {
          if (bitmap.close) bitmap.close()
          return blob
        }
        var scale = Math.min(1, MAX_EDGE / edge)
        var canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        var context = canvas.getContext('2d')
        if (!context) {
          if (bitmap.close) bitmap.close()
          return blob
        }
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        if (bitmap.close) bitmap.close()
        var smaller = await new Promise(function (resolve) {
          canvas.toBlob(function (value) { resolve(value) }, 'image/png')
        })
        return smaller && smaller.size > 0 && smaller.size < blob.size ? smaller : blob
      } catch {
        return blob
      }
    }

    function timestamp() {
      var now = new Date()
      var pad = function (value) { return String(value).padStart(2, '0') }
      return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
    }

    function CameraIcon() {
      return h('svg', {
        className: 'dshs-camera',
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      }, [
        h('path', { key: 'bump', d: 'M5.6 3.6l.7-1.1h3.4l.7 1.1' }),
        h('rect', { key: 'body', x: 1.6, y: 3.5, width: 12.8, height: 9.4, rx: 2 }),
        h('circle', { key: 'lens', cx: 8, cy: 8.2, r: 2.5 })
      ])
    }

    function ScreenshotButton(props) {
      var locked = props && props.locked === true
      var state = react.useState({ phase: 'idle', error: '' })
      var view = state[0]
      var setView = state[1]
      var abortRef = react.useRef(null)

      react.useEffect(function () {
        return function () {
          var controller = abortRef.current
          abortRef.current = null
          if (controller) {
            try { controller.abort() } catch { /* 忽略 */ }
            try {
              fetch('/dsh-shot/cancel', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(function () {})
            } catch { /* 忽略 */ }
          }
          clearToast()
        }
      }, [])

      /**
       * 结束这次截图等待：先告诉 Host 释放占位并强杀 PowerShell，再中断本地 fetch。
       * 顺序很重要——只 abort fetch 时 Host 仍可能认为“正在截屏”，下一次就 409。
       */
      function cancelCapture(options) {
        var controller = abortRef.current
        abortRef.current = null
        try {
          fetch('/dsh-shot/cancel', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(function () {})
        } catch { /* 忽略 */ }
        if (controller) {
          try { controller.abort() } catch { /* 忽略 */ }
        }
        setView({ phase: 'idle', error: '' })
        if (options && options.toast) showToast(options.toast, 'ok', 1400)
      }

      async function shoot() {
        if (view.phase === 'busy' || locked) return
        var controller = new AbortController()
        abortRef.current = controller
        setView({ phase: 'busy', error: '' })

        try {
          var captureUrl = '/dsh-shot/capture' + (readHideApp() ? '?hideApp=1' : '')
          var response = await fetch(captureUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'image/png' },
            signal: controller.signal
          })
          if (!response.ok) {
            var detail = ''
            try {
              var payload = await response.json()
              detail = payload && (payload.error || payload.message) ? String(payload.error || payload.message) : ''
            } catch { /* 非 JSON */ }
            if (response.status === 409) throw new Error('上一次截屏还没结束，再点一次试试')
            throw new Error(detail || ('截屏失败（HTTP ' + response.status + '）'))
          }
          var blob = await response.blob()
          if (!blob || blob.size === 0) throw new Error('截屏结果为空')
          blob = await normalize(blob)
          var file = new File([blob], 'screenshot-' + timestamp() + '.png', { type: 'image/png' })
          if (!(await insertImage(file))) throw new Error('截图已生成，但当前输入框不接受图片（可能正在生成回复）')
          setView({ phase: 'idle', error: '' })
          showToast('截图已插入输入框', 'ok', 1800)
        } catch (error) {
          var message = error instanceof Error ? error.message : String(error)
          if (message === '已取消' || (error && error.name === 'AbortError')) {
            setView({ phase: 'idle', error: '' })
          } else {
            setView({ phase: 'idle', error: message })
            showToast(message, 'error', 4200)
          }
        } finally {
          if (abortRef.current === controller) abortRef.current = null
        }
      }

      var busy = view.phase === 'busy'
      return h('button', {
        type: 'button',
        className: 'dshs-shot',
        'data-busy': busy ? 'true' : 'false',
        'data-dsh-screenshot': 'button',
        'aria-label': busy ? '取消截屏' : '截屏',
        'aria-busy': busy ? 'true' : 'false',
        title: busy ? '取消截屏（也可以按 Esc 退出截图）' : '截屏（点击后直接拖选区域，回车确认）',
        disabled: locked,
        onMouseDown: function (event) { event.preventDefault() },
        onClick: busy ? function () { cancelCapture({ toast: '已取消截屏' }) } : shoot
      }, busy ? h('span', { className: 'dshs-spinner', 'aria-hidden': 'true' }) : h(CameraIcon))
    }

    var HIDE_KEY = 'dsh-screenshot:hideApp'

    function readHideApp() {
      try {
        return localStorage.getItem(HIDE_KEY) === '1'
      } catch {
        return false
      }
    }

    function writeHideApp(value) {
      try {
        localStorage.setItem(HIDE_KEY, value ? '1' : '0')
      } catch {
        /* 忽略 */
      }
    }

    function EyeIcon(props) {
      var off = props && props.off === true
      var children = [
        h('path', { key: 'eye', d: 'M1.6 8s2.4-4.3 6.4-4.3S14.4 8 14.4 8 12 12.3 8 12.3 1.6 8 1.6 8z' }),
        h('circle', { key: 'pupil', cx: 8, cy: 8, r: 2.2 })
      ]
      if (off) children.push(h('path', { key: 'slash', d: 'M2.2 2.2l11.6 11.6' }))
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      }, children)
    }

    /** 截屏前的小开关：隐藏 / 保留整个 DSH 会话窗口。 */
    function HideToggle() {
      var state = react.useState(readHideApp())
      var hide = state[0]
      var setHide = state[1]

      react.useEffect(function () {
        writeHideApp(hide)
      }, [hide])

      return h('button', {
        type: 'button',
        className: 'dshs-shot',
        'data-active': hide ? 'true' : 'false',
        'data-dsh-screenshot': 'hide-toggle',
        'aria-label': '截屏时隐藏 DeepSeek Harness 窗口',
        'aria-pressed': hide ? 'true' : 'false',
        title: hide ? '截屏时隐藏 DSH 窗口（已开启）' : '截屏时隐藏 DSH 窗口',
        onMouseDown: function (event) { event.preventDefault() },
        onClick: function () { setHide(!hide) }
      }, h(EyeIcon, { off: hide }))
    }

    var inject = ['slots']

    function apply(ctx) {
      /*
       * 座位选择：`conversation.input.right` 是 list 座位（允许多个占位者），
       * 语音输入用的 `conversation.input.activity` 是 single 座位。
       * 我们用 list 座位 + CSS order:1，视觉上落在模型选择器之后、activity 之前：
       *   [模型] [📷 截屏] [👁 隐藏窗口] [🎤 语音] [发送]
       * 语音不在时就是 [模型] [📷] [👁] [发送]，不会抢座、不会让语音插件注册失败。
       */
      ctx.slots.inject('conversation.input.right', function () {
        return ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-screenshot',
          order: 100,
          priority: 0
        }, ScreenshotButton)
      })
      ctx.slots.inject('conversation.input.right', function () {
        return ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-screenshot-hide',
          order: 101,
          priority: 0
        }, HideToggle)
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
