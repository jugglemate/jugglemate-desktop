const { app, BrowserWindow, ipcMain, shell } = require('electron')
const JMain = require('jugglechat-electron/main')
const path = require('path')
const http = require('http')
const fs = require('fs')
let mainWindow = null

// ====================== 窗口控制 IPC ======================

ipcMain.on('window-minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.on('window-close', () => {
  mainWindow?.close()
})

ipcMain.handle('window-is-maximized', () => {
  return mainWindow?.isMaximized() ?? false
})

// ====================== 外部链接 ======================
// 渲染进程请求在系统默认浏览器中打开 URL（管理后台、帮助文档等）。
// 用主进程的 shell.openExternal 而不是 window.open，是因为 window.open
// 在 Electron 里会开成新的 BrowserWindow 而不是系统浏览器。

ipcMain.handle('open-external', async (_event, url) => {
  if (typeof url !== 'string' || !url) {
    return { ok: false, error: 'invalid url' }
  }
  // 兜底：只放 http(s)，避免被滥用去打开 file:// 等本地协议
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'only http(s) urls are allowed' }
  }
  await shell.openExternal(url)
  return { ok: true }
})

// ====================== 静态文件服务器（生产模式） ======================

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

/**
 * 创建静态文件服务器，监听指定端口（或系统分配），
 * 支持 SPA fallback：非文件路径全部返回 index.html。
 * @param {string} rootDir - 静态文件根目录
 * @param {number} preferredPort - 首选端口
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
function startStaticServer(rootDir, preferredPort = 15173) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Browser requests percent-encode spaces and non-ASCII file names.
      // Decode before resolving against dist so resources such as
      // `AnimatedSticker (1).tgs` can be served in packaged builds.
      let urlPath
      try {
        urlPath = decodeURIComponent(req.url.split('?')[0])
      } catch {
        res.writeHead(400)
        res.end('Bad Request')
        return
      }
      const ext = path.extname(urlPath)

      // 有扩展名 → 视为静态文件；否则 → SPA fallback
      const filePath = ext
        ? path.join(rootDir, urlPath)
        : path.join(rootDir, 'index.html')

      const contentType = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream'

      fs.readFile(filePath, (err, data) => {
        if (err) {
          // 静态文件 404 → fallback 到 index.html（SPA 路由）
          if (ext) {
            fs.readFile(path.join(rootDir, 'index.html'), (err2, data2) => {
              if (err2) {
                res.writeHead(404)
                res.end('Not Found')
              } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                res.end(data2)
              }
            })
          } else {
            res.writeHead(404)
            res.end('Not Found')
          }
          return
        }
        res.writeHead(200, { 'Content-Type': contentType })
        res.end(data)
      })
    })

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && preferredPort !== 0) {
        // 端口被占用，用 0 让系统分配
        console.log(`[server] 端口 ${preferredPort} 被占用，改用系统分配`)
        startStaticServer(rootDir, 0).then(resolve).catch(reject)
        return
      }
      reject(err)
    })

    server.listen(preferredPort, '127.0.0.1', () => {
      const port = server.address().port
      console.log(`[server] 静态服务已启动: http://127.0.0.1:${port}`)
      resolve({ server, port })
    })
  })
}

let rendererServer = null


let splashWindow = null

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 420,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    skipTaskbar: true,
    alwaysOnTop: false,
    center: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  splashWindow.setIgnoreMouseEvents(true)
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
  splashWindow.once('ready-to-show', () => splashWindow.show())
  splashWindow.on('closed', () => { splashWindow = null })
}

// ====================== 窗口创建 ======================

async function createWindow() {
  createSplashWindow()

  mainWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#0F172A',
    width: 1400,
    height: 900,
    title: '',
    minWidth: 1200,
    minHeight: 700,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    ...(process.platform === 'darwin' ? {
      trafficLightPosition: { x: 4, y: 4 }
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      // SDK 在 preload 中通过 contextBridge 暴露 JGChatPCClient，页面无需 Node 权限。
      nodeIntegration: false,
      // 第三方 preload 依赖常规 Node require，不能运行在 sandboxed preload 中。
      sandbox: false
    }
  })

  // 关闭 splash 并显示主窗的统一入口
  let splashDismissed = false
  function dismissSplash() {
    if (splashDismissed) return
    splashDismissed = true
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy()
    }
  }
  mainWindow.once('ready-to-show', dismissSplash)
  mainWindow.webContents.once('did-finish-load', dismissSplash)
  mainWindow.once('show', dismissSplash)
  // 兜底：3 秒无论如何都关掉 splash，避免卡死
  setTimeout(dismissSplash, 3000)
  // 开发模式只清理可再生成的页面缓存。不要清理 IndexedDB：JuggleIM PC
  // provider 会把消息及 message.attribute（例如翻译结果）保存在本地消息库中。
  // 启动时删除 IndexedDB 会导致 Electron 重启后本地消息扩展丢失。
  const { session } = require('electron')
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
  }

  // 绕过浏览器 CORS：前端 IM SDK 直连 ws.snailchat.im + API 请求 mate.juggle.im
  // Electron 从 http://127.0.0.1:port 加载页面，跨域请求需要注入 CORS 响应头。
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: [
      'https://ws.snailchat.im/*', 'http://ws.snailchat.im/*',
      'https://mate.juggle.im/*', 'http://mate.juggle.im/*',
    ] },
    (details, callback) => {
      details.responseHeaders['Access-Control-Allow-Origin'] = ['*']
      details.responseHeaders['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS']
      details.responseHeaders['Access-Control-Allow-Headers'] = ['*']
      callback({ responseHeaders: details.responseHeaders })
    }
  )

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5174')
    mainWindow.webContents.openDevTools()
  } else {
  //   // 生产模式：启动内部静态服务器，通过 loadURL 加载
    const rootDir = path.join(__dirname, '../dist')
    try {
      const { port } = await startStaticServer(rootDir, 15173)
      mainWindow.loadURL(`http://127.0.0.1:${port}`)
    } catch (err) {
      console.error('[main] 静态服务器启动失败:', err)
      // fallback: 降级到 loadFile
      mainWindow.loadFile(path.join(rootDir, 'index.html'))
    }
  }

  // 快捷键：Cmd+Shift+I 打开 DevTools（开发/生产均可用）
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if ((input.meta || input.control) && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
    }
  })
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, '../build/icon.png'))
  }
  // 先注册 SDK 的 IPC handlers，再加载会调用这些 handlers 的渲染页面。
  JMain.init()
  await createWindow()
})

app.on('window-all-closed', () => {
  if (rendererServer) {
    rendererServer.close()
    rendererServer = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
