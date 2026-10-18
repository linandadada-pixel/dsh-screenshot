using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Native
{
    [DllImport("user32.dll")]
    internal static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    internal static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    internal static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    internal static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pprSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    internal static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    internal static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    internal static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    internal static extern bool DeleteObject(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct SIZE
    {
        public int cx;
        public int cy;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    internal struct BLENDFUNCTION
    {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }

    internal const int ULW_ALPHA = 2;
    internal const byte AC_SRC_OVER = 0;

    internal static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    internal const uint SWP_NOSIZE = 0x0001;
    internal const uint SWP_NOMOVE = 0x0002;
    internal const uint SWP_SHOWWINDOW = 0x0040;
}

internal static class Diag
{
    internal static string LogPath;

    internal static void Write(string message)
    {
        if (LogPath == null) return;
        try
        {
            System.IO.File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + Environment.NewLine);
        }
        catch
        {
        }
    }
}

internal static class Blit
{
    internal static void Push(Form form, Bitmap bitmap)
    {
        IntPtr screenDc = Native.GetDC(IntPtr.Zero);
        IntPtr memDc = Native.CreateCompatibleDC(screenDc);
        IntPtr hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
        IntPtr old = Native.SelectObject(memDc, hBitmap);

        Native.POINT dst = new Native.POINT();
        dst.X = form.Bounds.Left;
        dst.Y = form.Bounds.Top;
        Native.SIZE size = new Native.SIZE();
        size.cx = bitmap.Width;
        size.cy = bitmap.Height;
        Native.POINT src = new Native.POINT();
        src.X = 0;
        src.Y = 0;
        Native.BLENDFUNCTION blend = new Native.BLENDFUNCTION();
        blend.BlendOp = Native.AC_SRC_OVER;
        blend.BlendFlags = 0;
        blend.SourceConstantAlpha = 255;
        blend.AlphaFormat = 0; // opaque
        Native.UpdateLayeredWindow(form.Handle, screenDc, ref dst, ref size, memDc, ref src, 0, ref blend, Native.ULW_ALPHA);

        Native.SelectObject(memDc, old);
        Native.DeleteObject(hBitmap);
        Native.DeleteDC(memDc);
        Native.ReleaseDC(IntPtr.Zero, screenDc);
    }
}

internal static class Painter
{
    internal const int HandleSize = 8;
    internal static readonly Color Green = Color.FromArgb(255, 7, 193, 96);
    private static readonly Font LabelFont = new Font("Segoe UI", 9f, FontStyle.Regular, GraphicsUnit.Point);

    internal static void DrawDimmed(Graphics g, Bitmap dimmed, Rectangle view, Size client)
    {
        g.DrawImage(dimmed, new Rectangle(0, 0, client.Width, client.Height), view, GraphicsUnit.Pixel);
    }

    internal static void DrawBright(Graphics g, Bitmap screen, Rectangle selection, Rectangle view)
    {
        Rectangle local = new Rectangle(selection.X - view.X, selection.Y - view.Y, selection.Width, selection.Height);
        g.DrawImage(screen, local, selection, GraphicsUnit.Pixel);
    }

    internal static void DrawSelection(Graphics g, Rectangle localSel, Size client, out Rectangle confirm, out Rectangle cancel)
    {
        using (Pen border = new Pen(Green, 2f))
        {
            g.DrawRectangle(border, localSel.Left, localSel.Top, localSel.Width - 1, localSel.Height - 1);
        }
        DrawHandles(g, localSel);
        DrawSizeLabel(g, localSel, client);
        DrawToolbar(g, localSel, client, out confirm, out cancel);
    }

    internal static void DrawHint(Graphics g, Size client)
    {
        string text = "拖选区域  ·  Esc 取消";
        SizeF size = g.MeasureString(text, LabelFont);
        int width = (int)size.Width + 28;
        int height = (int)size.Height + 14;
        int x = (client.Width - width) / 2;
        int y = 26;
        using (GraphicsPath path = Rounded(new Rectangle(x, y, width, height), 8))
        using (SolidBrush back = new SolidBrush(Color.FromArgb(210, 22, 24, 28)))
        using (SolidBrush fore = new SolidBrush(Color.White))
        {
            g.FillPath(back, path);
            g.DrawString(text, LabelFont, fore, x + 14, y + 7);
        }
    }

    private static void DrawHandles(Graphics g, Rectangle sel)
    {
        int cx = sel.Left + sel.Width / 2;
        int cy = sel.Top + sel.Height / 2;
        Point[] centers =
        {
            new Point(sel.Left, sel.Top), new Point(cx, sel.Top), new Point(sel.Right, sel.Top),
            new Point(sel.Right, cy), new Point(sel.Right, sel.Bottom), new Point(cx, sel.Bottom),
            new Point(sel.Left, sel.Bottom), new Point(sel.Left, cy)
        };
        using (SolidBrush fill = new SolidBrush(Color.White))
        using (Pen pen = new Pen(Green, 1.4f))
        {
            foreach (Point p in centers)
            {
                Rectangle r = new Rectangle(p.X - HandleSize / 2, p.Y - HandleSize / 2, HandleSize, HandleSize);
                g.FillRectangle(fill, r);
                g.DrawRectangle(pen, r);
            }
        }
    }

    private static void DrawSizeLabel(Graphics g, Rectangle sel, Size client)
    {
        string text = sel.Width + " × " + sel.Height;
        SizeF size = g.MeasureString(text, LabelFont);
        int width = (int)size.Width + 16;
        int height = (int)size.Height + 10;
        int x = sel.Left;
        int y = sel.Top - height - 6;
        if (y < 2) y = sel.Top + 6;
        if (x + width > client.Width) x = client.Width - width - 2;
        using (GraphicsPath path = Rounded(new Rectangle(x, y, width, height), 6))
        using (SolidBrush back = new SolidBrush(Green))
        using (SolidBrush fore = new SolidBrush(Color.White))
        {
            g.FillPath(back, path);
            g.DrawString(text, LabelFont, fore, x + 8, y + 4);
        }
    }

    private static void DrawToolbar(Graphics g, Rectangle sel, Size client, out Rectangle confirm, out Rectangle cancel)
    {
        const int button = 28;
        const int gap = 6;
        const int pad = 5;
        int panelWidth = pad * 2 + button * 2 + gap;
        int panelHeight = pad * 2 + button;

        int x = sel.Right - panelWidth;
        int y = sel.Bottom + 8;
        if (y + panelHeight > client.Height - 4) y = sel.Bottom - panelHeight - 8;
        if (y < 4) y = sel.Top + 8;
        if (x < 4) x = sel.Left + 8;
        if (x + panelWidth > client.Width - 4) x = client.Width - panelWidth - 4;

        Rectangle panel = new Rectangle(x, y, panelWidth, panelHeight);
        confirm = new Rectangle(x + pad, y + pad, button, button);
        cancel = new Rectangle(x + pad + button + gap, y + pad, button, button);

        using (GraphicsPath path = Rounded(panel, 10))
        using (SolidBrush back = new SolidBrush(Color.FromArgb(246, 250, 250, 252)))
        using (Pen edge = new Pen(Color.FromArgb(38, 0, 0, 0), 1f))
        {
            g.FillPath(back, path);
            g.DrawPath(edge, path);
        }

        using (SolidBrush fill = new SolidBrush(Green))
        {
            g.FillEllipse(fill, confirm);
        }
        using (Pen check = new Pen(Color.White, 2f))
        {
            check.StartCap = LineCap.Round;
            check.EndCap = LineCap.Round;
            g.DrawLines(check, new Point[]
            {
                new Point(confirm.Left + 8, confirm.Top + 14),
                new Point(confirm.Left + 12, confirm.Top + 19),
                new Point(confirm.Left + 20, confirm.Top + 9)
            });
        }
        using (Pen cross = new Pen(Color.FromArgb(255, 96, 100, 108), 2f))
        {
            cross.StartCap = LineCap.Round;
            cross.EndCap = LineCap.Round;
            g.DrawLine(cross, cancel.Left + 9, cancel.Top + 9, cancel.Right - 9, cancel.Bottom - 9);
            g.DrawLine(cross, cancel.Right - 9, cancel.Top + 9, cancel.Left + 9, cancel.Bottom - 9);
        }
    }

    private static GraphicsPath Rounded(Rectangle rect, int radius)
    {
        GraphicsPath path = new GraphicsPath();
        int d = radius * 2;
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal sealed class ShotState
{
    internal const int Margin = 60;

    internal readonly Bitmap Screen;
    internal readonly Bitmap Dimmed;
    internal readonly string OutPath;
    internal readonly Point Origin;
    internal BackdropForm Backdrop;
    internal OverlayForm Overlay;

    internal Rectangle Selection = Rectangle.Empty;
    internal int Mode; // 0 idle, 1 creating, 2 moving, 3 resizing
    internal int Handle = -1;
    internal Point DragStart;
    internal Rectangle DragRect;
    internal int ExitCode = 2;

    internal ShotState(Bitmap screen, string outPath, Point origin)
    {
        Screen = screen;
        Dimmed = BuildDimmed(screen);
        OutPath = outPath;
        Origin = origin;
    }

    internal Point ToImage(Form form, Point client)
    {
        Point screen = form.PointToScreen(client);
        return new Point(screen.X - Origin.X, screen.Y - Origin.Y);
    }

    internal void PointerDown(Form form, Point client, MouseButtons button)
    {
        Point p = ToImage(form, client);
        if (button == MouseButtons.Right)
        {
            Cancel();
            return;
        }
        if (button != MouseButtons.Left) return;

        if (Selection.Width > 0 && Overlay != null && Overlay.HitToolbar(p)) return;

        int hit = Selection.Width > 0 ? HitHandle(p) : -1;
        if (hit >= 0)
        {
            Mode = 3;
            Handle = hit;
            DragStart = p;
            DragRect = Selection;
            return;
        }
        if (Selection.Width > 0 && Selection.Contains(p))
        {
            Mode = 2;
            DragStart = p;
            DragRect = Selection;
            return;
        }

        Mode = 1;
        DragStart = p;
        Selection = Rectangle.Empty;
        if (Overlay != null) Overlay.HideOverlay();
        if (Backdrop != null) Backdrop.SetHint(false);
    }

    private Point lastPointer = new Point(int.MinValue, int.MinValue);

    internal void PointerMove(Form form, Point client)
    {
        Point p = ToImage(form, client);
        if (Mode != 0 && p == lastPointer) return;
        lastPointer = p;
        if (Mode == 0)
        {
            UpdateCursor(form, p);
            return;
        }

        if (Mode == 1)
        {
            Selection = Normalize(DragStart, p);
        }
        else if (Mode == 2)
        {
            int dx = p.X - DragStart.X;
            int dy = p.Y - DragStart.Y;
            Selection = Clamp(new Rectangle(DragRect.Left + dx, DragRect.Top + dy, DragRect.Width, DragRect.Height));
        }
        else if (Mode == 3)
        {
            Selection = Resize(DragRect, Handle, p);
        }

        if (Selection.Width >= 3 && Selection.Height >= 3 && Overlay != null) Overlay.ShowFor(Selection);
        UpdateCursor(form, p);
    }

    internal void PointerUp(Form form, Point client)
    {
        Point p = ToImage(form, client);
        if (Mode == 1 && (Selection.Width < 4 || Selection.Height < 4))
        {
            Selection = Rectangle.Empty;
            if (Overlay != null) Overlay.HideOverlay();
            if (Backdrop != null) Backdrop.SetHint(true);
        }
        Mode = 0;
        Handle = -1;
        UpdateCursor(form, p);
    }

    private void UpdateCursor(Form form, Point p)
    {
        if (Overlay == null) return;
        if (Selection.Width > 0)
        {
            if (Overlay.HitToolbar(p)) { form.Cursor = Cursors.Hand; return; }
            if (HitHandle(p) >= 0) { form.Cursor = Cursors.SizeAll; return; }
            if (Selection.Contains(p)) { form.Cursor = Cursors.SizeAll; return; }
        }
        form.Cursor = Cursors.Cross;
    }

    internal int HitHandle(Point p)
    {
        if (Selection.Width <= 0) return -1;
        Point[] centers = HandleCenters();
        for (int i = 0; i < centers.Length; i++)
        {
            if (Math.Abs(p.X - centers[i].X) <= 6 && Math.Abs(p.Y - centers[i].Y) <= 6) return i;
        }
        return -1;
    }

    private Point[] HandleCenters()
    {
        int cx = Selection.Left + Selection.Width / 2;
        int cy = Selection.Top + Selection.Height / 2;
        return new Point[]
        {
            new Point(Selection.Left, Selection.Top), new Point(cx, Selection.Top), new Point(Selection.Right, Selection.Top),
            new Point(Selection.Right, cy), new Point(Selection.Right, Selection.Bottom), new Point(cx, Selection.Bottom),
            new Point(Selection.Left, Selection.Bottom), new Point(Selection.Left, cy)
        };
    }

    private Rectangle Resize(Rectangle original, int index, Point p)
    {
        int left = original.Left, top = original.Top, right = original.Right, bottom = original.Bottom;
        if (index == 0 || index == 6 || index == 7) left = p.X;
        if (index == 2 || index == 3 || index == 4) right = p.X;
        if (index == 0 || index == 1 || index == 2) top = p.Y;
        if (index == 4 || index == 5 || index == 6) bottom = p.Y;
        return Clamp(Normalize(new Point(left, top), new Point(right, bottom)));
    }

    private Rectangle Clamp(Rectangle rect)
    {
        int w = Screen.Width, h = Screen.Height;
        int left = Math.Max(0, Math.Min(rect.Left, w - 1));
        int top = Math.Max(0, Math.Min(rect.Top, h - 1));
        int right = Math.Max(0, Math.Min(rect.Right, w));
        int bottom = Math.Max(0, Math.Min(rect.Bottom, h));
        if (right <= left) right = Math.Min(w, left + 1);
        if (bottom <= top) bottom = Math.Min(h, top + 1);
        return Rectangle.FromLTRB(left, top, right, bottom);
    }

    private static Rectangle Normalize(Point a, Point b)
    {
        return Rectangle.FromLTRB(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Max(a.X, b.X), Math.Max(a.Y, b.Y));
    }

    internal void Confirm()
    {
        if (Selection.Width < 2 || Selection.Height < 2) return;
        try
        {
            using (Bitmap cropped = new Bitmap(Selection.Width, Selection.Height, PixelFormat.Format24bppRgb))
            using (Graphics g = Graphics.FromImage(cropped))
            {
                g.DrawImage(Screen, new Rectangle(0, 0, Selection.Width, Selection.Height), Selection, GraphicsUnit.Pixel);
                cropped.Save(OutPath, ImageFormat.Png);
            }
            ExitCode = 0;
        }
        catch
        {
            ExitCode = 3;
        }
        Shutdown();
    }

    internal void Cancel()
    {
        ExitCode = 2;
        Shutdown();
    }

    private void Shutdown()
    {
        if (Overlay != null) Overlay.HideOverlay();
        if (Backdrop != null) Backdrop.Close();
        Application.ExitThread();
    }

    private static Bitmap BuildDimmed(Bitmap source)
    {
        int width = source.Width;
        int height = source.Height;
        Bitmap result = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        Rectangle rect = new Rectangle(0, 0, width, height);
        BitmapData sourceData = source.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        BitmapData targetData = result.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
        try
        {
            int rowBytes = width * 3;
            byte[] row = new byte[rowBytes];
            for (int y = 0; y < height; y++)
            {
                Marshal.Copy(IntPtr.Add(sourceData.Scan0, y * sourceData.Stride), row, 0, rowBytes);
                for (int i = 0; i < rowBytes; i++) row[i] = (byte)(row[i] * 55 / 100);
                Marshal.Copy(row, 0, IntPtr.Add(targetData.Scan0, y * targetData.Stride), rowBytes);
            }
        }
        finally
        {
            source.UnlockBits(sourceData);
            result.UnlockBits(targetData);
        }
        return result;
    }
}

internal sealed class BackdropForm : Form
{
    private readonly ShotState state;
    private Bitmap canvas;
    private Graphics canvasGraphics;
    private bool hint = true;

    internal BackdropForm(ShotState state)
    {
        this.state = state;
        Bounds = SystemInformation.VirtualScreen;
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        BackColor = Color.Black;
        KeyPreview = true;
        Cursor = Cursors.Cross;
        AutoScaleMode = AutoScaleMode.None;
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x00080000; // WS_EX_LAYERED
            return cp;
        }
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Native.SetWindowPos(Handle, Native.HWND_TOPMOST, 0, 0, 0, 0,
            Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_SHOWWINDOW);
        Activate();
        Focus();
        Render();
    }

    internal void SetHint(bool visible)
    {
        if (hint == visible) return;
        hint = visible;
        Render();
    }

    private void Render()
    {
        if (!IsHandleCreated) return;
        int w = ClientSize.Width, h = ClientSize.Height;
        if (w <= 0 || h <= 0) return;
        if (canvas == null || canvas.Width != w || canvas.Height != h)
        {
            if (canvasGraphics != null) canvasGraphics.Dispose();
            if (canvas != null) canvas.Dispose();
            canvas = new Bitmap(w, h, PixelFormat.Format32bppRgb);
            canvasGraphics = Graphics.FromImage(canvas);
            canvasGraphics.InterpolationMode = InterpolationMode.NearestNeighbor;
            canvasGraphics.PixelOffsetMode = PixelOffsetMode.Half;
        }
        canvasGraphics.DrawImageUnscaled(state.Dimmed, 0, 0);
        if (hint) Painter.DrawHint(canvasGraphics, ClientSize);
        Blit.Push(this, canvas);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        state.PointerDown(this, e.Location, e.Button);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        state.PointerMove(this, e.Location);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        state.PointerUp(this, e.Location);
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape)
        {
            state.Cancel();
            e.Handled = true;
        }
        else if (e.KeyCode == Keys.Enter && state.Selection.Width >= 4 && state.Selection.Height >= 4)
        {
            state.Confirm();
            e.Handled = true;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (canvasGraphics != null) canvasGraphics.Dispose();
            if (canvas != null) canvas.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal sealed class OverlayForm : Form
{
    private readonly ShotState state;
    private Bitmap canvas;
    private Graphics canvasGraphics;
    private Rectangle view;
    private Rectangle confirmRect;
    private Rectangle cancelRect;

    internal OverlayForm(ShotState state)
    {
        this.state = state;
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        BackColor = Color.Black;
        AutoScaleMode = AutoScaleMode.None;
        Cursor = Cursors.Cross;
    }

    protected override bool ShowWithoutActivation
    {
        get { return true; }
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x00080000; // WS_EX_LAYERED
            cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
            cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
            return cp;
        }
    }

    internal void HideOverlay()
    {
        if (Visible) Hide();
    }

    internal void ShowFor(Rectangle selection)
    {
        int margin = ShotState.Margin;
        int w = state.Screen.Width, h = state.Screen.Height;
        Rectangle rect = Rectangle.Inflate(selection, margin, margin);
        rect.Intersect(new Rectangle(0, 0, w, h));
        if (rect.Width <= 0 || rect.Height <= 0) return;

        Rectangle screenRect = new Rectangle(state.Origin.X + rect.X, state.Origin.Y + rect.Y, rect.Width, rect.Height);
        if (Bounds != screenRect) Bounds = screenRect;
        view = rect;

        if (!Visible)
        {
            Show();
            Native.SetWindowPos(Handle, Native.HWND_TOPMOST, 0, 0, 0, 0,
                Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_SHOWWINDOW);
        }
        Render(selection);
    }

    private void Render(Rectangle selection)
    {
        int w = ClientSize.Width, h = ClientSize.Height;
        if (w <= 0 || h <= 0) return;
        Stopwatch watch = Stopwatch.StartNew();
        if (canvas == null || canvas.Width != w || canvas.Height != h)
        {
            if (canvasGraphics != null) canvasGraphics.Dispose();
            if (canvas != null) canvas.Dispose();
            canvas = new Bitmap(w, h, PixelFormat.Format32bppRgb);
            canvasGraphics = Graphics.FromImage(canvas);
            canvasGraphics.InterpolationMode = InterpolationMode.NearestNeighbor;
            canvasGraphics.PixelOffsetMode = PixelOffsetMode.Half;
        }

        Painter.DrawDimmed(canvasGraphics, state.Dimmed, view, ClientSize);
        Rectangle localSel = new Rectangle(selection.X - view.X, selection.Y - view.Y, selection.Width, selection.Height);
        Painter.DrawBright(canvasGraphics, state.Screen, selection, view);
        Painter.DrawSelection(canvasGraphics, localSel, ClientSize, out confirmRect, out cancelRect);
        confirmRect.Offset(view.X, view.Y);
        cancelRect.Offset(view.X, view.Y);
        Blit.Push(this, canvas);
        watch.Stop();
        Diag.Write("overlay " + watch.ElapsedMilliseconds + "ms " + w + "x" + h + " sel=" + selection);
    }

    internal bool HitToolbar(Point image)
    {
        return confirmRect.Contains(image) || cancelRect.Contains(image);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        Point image = state.ToImage(this, e.Location);
        if (e.Button == MouseButtons.Left && confirmRect.Contains(image))
        {
            state.Confirm();
            return;
        }
        if (e.Button == MouseButtons.Left && cancelRect.Contains(image))
        {
            state.Cancel();
            return;
        }
        state.PointerDown(this, e.Location, e.Button);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        state.PointerMove(this, e.Location);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        state.PointerUp(this, e.Location);
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape) state.Cancel();
        else if (e.KeyCode == Keys.Enter && state.Selection.Width >= 4 && state.Selection.Height >= 4) state.Confirm();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (canvasGraphics != null) canvasGraphics.Dispose();
            if (canvas != null) canvas.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) Native.SetProcessDPIAware();
        }
        catch
        {
            try { Native.SetProcessDPIAware(); } catch { }
        }

        string outPath = null;
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--out", StringComparison.OrdinalIgnoreCase)) outPath = args[i + 1];
            if (string.Equals(args[i], "--log", StringComparison.OrdinalIgnoreCase)) Diag.LogPath = args[i + 1];
        }
        if (string.IsNullOrEmpty(outPath)) return 3;
        Diag.Write("main start out=" + outPath);

        try
        {
            Application.EnableVisualStyles();
            Rectangle bounds = SystemInformation.VirtualScreen;
            Bitmap screen = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
            using (Graphics g = Graphics.FromImage(screen))
            {
                g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, screen.Size, CopyPixelOperation.SourceCopy);
            }

            ShotState state = new ShotState(screen, outPath, bounds.Location);
            BackdropForm backdrop = new BackdropForm(state);
            OverlayForm overlay = new OverlayForm(state);
            state.Backdrop = backdrop;
            state.Overlay = overlay;
            Application.Run(backdrop);
            return state.ExitCode;
        }
        catch (Exception error)
        {
            Diag.Write("error " + error);
            return 3;
        }
    }
}
