const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')
const imService = require('./im-service.cjs')

let mainWindow = null

// 初始化 IM SDK（不连接，等 token）
console.log('[main] 应用启动，初始化 IM SDK...')
imService.init()
console.log('[main] IM SDK 初始化完成')

// 注册消息回调 → 通过 IPC 发给渲染进程
imService.onMessage((message) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('im-message-received', {
      messageId: message.messageId || message.msg_id || message.id || '',
      senderId: message.sender?.id || message.senderId || '',
      senderName: message.sender?.name || message.sender?.nickName || '',
      conversationId: message.conversationId || '',
      conversationType: message.conversationType,
      content: message.content,
      sentTime: message.sentTime || message.sendTime || Date.now(),
      name: message.name || ''
    })
  }
})

// IPC：渲染进程传来 token，主进程连接 IM
ipcMain.handle('im-connect', async (_event, token) => {
  console.log('[main] im-connect 收到连接请求')
  try {
    const user = await imService.connect(token)
    console.log('[main] im-connect 登录成功，用户 ID:', user?.id || user?.userId)
    return { success: true, userId: user?.id || user?.userId }
  } catch (err) {
    console.error('[main] im-connect 登录失败:', err?.message || err)
    return { success: false, error: err.message }
  }
})

// IPC：获取当前 IM 用户
ipcMain.handle('im-get-current-user', () => {
  return imService.getCurrentUser()
})

// IPC：检查 IM 连接状态
ipcMain.handle('im-get-status', () => {
  const user = imService.getCurrentUser()
  return {
    running: !!imService,
    connected: !!user,
    userId: user?.id || user?.userId || null
  }
})

// IPC：渲染进程设置 API Server 地址，同步到 imService
ipcMain.handle('im-set-api-server', async (_event, apiBaseUrl) => {
  console.log('[main] im-set-api-server received:', apiBaseUrl)
  imService.updateApiBaseUrl(apiBaseUrl)
  return { success: true }
})

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
      trafficLightPosition: { x: 12, y: 16 }
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

  // if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
  //   mainWindow.loadURL('http://localhost:5173')
  //   mainWindow.webContents.openDevTools()
  // } else {
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
  // }

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
