const { app, BrowserWindow, ipcMain, shell } = require('electron')
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
      const urlPath = req.url.split('?')[0]
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

// ====================== 窗口创建 ======================

async function createWindow() {
  mainWindow = new BrowserWindow({
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
      nodeIntegration: false
    }
  })

  // 开发模式每次启动清缓存，避免旧页面残留。但保留 localStorage 以免登录态丢失。
  const { session } = require('electron')
  session.defaultSession.clearStorageData({ storages: ['cookies', 'indexdb', 'serviceworkers', 'cachestorage'] })

  // 绕过浏览器 CORS：前端 IM SDK 需要直连 ws.snailchat.im
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://ws.snailchat.im/*', 'http://ws.snailchat.im/*'] },
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
  })
}

app.whenReady().then(createWindow)

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
