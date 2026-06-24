/**
 * im-service.cjs — Electron 主进程 IM 消息中转服务
 *
 * 封装 JuggleIM Node SDK 的连接和消息中转逻辑。
 * token 由登录动态获取，不再写死。
 */

const path = require('path')
const http = require('http')
const { URL } = require('url')
const JuggleIM = require('./libs/juggleim-node-1.9.8.cjs')

const { Event, ConnectionState, ConversationType } = JuggleIM

// ====================== 配置 ======================
const APPKEY = 'nwm6fxqt2aeebhb7'
const SERVER = 'ws://ws.snailchat.im'
const AI_BOT_ID = 'agentMsgBot'
// API Server 地址，可由外部通过 updateApiBaseUrl 动态修改
let API_SERVER = 'http://127.0.0.1:8050'

function buildForwardUrl() {
  return `${API_SERVER}/botmsgs/forward`
}

function updateApiBaseUrl(apiBaseUrl) {
  if (!apiBaseUrl) return
  // 兼容前端 getApiBaseUrl 返回的不带协议的值（如 "localhost:8050"）
  const trimmed = apiBaseUrl.trim()
  API_SERVER = trimmed.startsWith('http') ? trimmed : `http://${trimmed}`
  console.log(`[im-service] API_SERVER updated → ${API_SERVER}`)
}

// ====================== 状态 ======================
let client = null
let currentUser = null

// 状态名称映射
const STATE_NAMES = {
  [ConnectionState.CONNECTED]: '已连接',
  [ConnectionState.CONNECTING]: '连接中',
  [ConnectionState.DISCONNECTED]: '已断开',
  [ConnectionState.CONNECT_FAILED]: '连接失败',
  [ConnectionState.RECONNECTING]: '重连中',
}

// 会话类型名称映射
const CONV_TYPE_NAMES = {
  [ConversationType.PRIVATE]: '私聊',
  [ConversationType.GROUP]: '群组',
  [ConversationType.CHATROOM]: '聊天室',
  [ConversationType.SYSTEM]: '系统',
  [ConversationType.PUBLICH]: '公众号',
}

// ====================== 工具函数 ======================

/** 从 message.content 中提取文本 */
function extractText(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (typeof content.content === 'string') return content.content
  if (typeof content.msg_content === 'string') return content.msg_content
  return ''
}

function getCurrentUserId() {
  const me = currentUser
  return me?.id || me?.userId || me?.uid || ''
}

function getSenderId(message) {
  return message?.sender?.id || message?.sender?.userId || message?.sender?.uid || message?.senderId || ''
}

function getSenderName(message) {
  return message?.sender?.name || message?.sender?.nickName || message?.sender?.displayName || ''
}

function getReceiverId() {
  return getCurrentUserId()
}

function getConversationType(message) {
  return typeof message?.conversationType === 'number' ? message.conversationType : ConversationType.PRIVATE
}

function getMessageId(message) {
  return message?.messageId || message?.msg_id || message?.id || ''
}

function getMessageTime(message) {
  return message?.sentTime || message?.sendTime || message?.createdAt || Date.now()
}

function isTextMessage(message) {
  return extractText(message?.content).length > 0
}

function shouldIgnoreMessage(message) {
  const me = getCurrentUserId()
  const senderId = getSenderId(message)
  const senderName = getSenderName(message)

  if (senderId && me && senderId === me) {
    return { ignored: true, reason: 'self' }
  }

  if (senderId && senderId === AI_BOT_ID) {
    return { ignored: true, reason: 'ai_bot_id' }
  }

  if (senderName && senderName === AI_BOT_ID) {
    return { ignored: true, reason: 'ai_bot_name' }
  }

  if (!isTextMessage(message)) {
    return { ignored: true, reason: 'non_text' }
  }

  return { ignored: false, reason: '' }
}

/** 格式化发送者显示名 */
function formatSender(sender) {
  if (!sender) return '匿名'
  return sender.name || sender.nickName || sender.displayName || sender.id || '匿名'
}

/** 格式化消息接收日志 */
function logMessage(message) {
  const sender = formatSender(message.sender)
  const text = extractText(message.content)
  const convType = CONV_TYPE_NAMES[message.conversationType] || `type=${message.conversationType}`

  console.log(
    `[im-service] 消息 ${sender} | ${convType} | ${message.conversationId} | ${message.name}` +
      (text ? ` | ${text}` : '')
  )
}

function buildForwardBody(message) {
  const text = extractText(message.content)
  return {
    event_type: 'message',
    timestamp: Date.now(),
    payload: [
      {
        platform: 'node',
        sender: getSenderId(message),
        receiver: getReceiverId(),
        conver_type: getConversationType(message),
        msg_type: 'text',
        msg_content: text,
        mention_info: null,
        msg_id: getMessageId(message),
        msg_time: getMessageTime(message),
      },
    ],
  }
}

async function forwardToAppServer(message) {
  const url = buildForwardUrl()
  if (!url) {
    return
  }

  const body = buildForwardBody(message)
  const bodyStr = JSON.stringify(body)

  try {
    const parsed = new URL(url)

    const response = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 80,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            appkey: APPKEY,
          },
          timeout: 18000,
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => resolve({ status: res.statusCode, data }))
        }
      )
      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })
      req.write(bodyStr)
      req.end()
    })

    if (response.status < 200 || response.status >= 300) {
      console.error('[im-service] 转发失败', response.status, response.data)
      return
    }

    console.log(
      `[im-service] 转发成功 msg_id=${body.payload[0].msg_id} sender=${body.payload[0].sender} receiver=${body.payload[0].receiver}`
    )
  } catch (err) {
    console.error('[im-service] 转发异常', err?.message || err)
  }
}

// ====================== 公开 API ======================

/**
 * 初始化 IM SDK（不连接，等 token）
 */
function init() {
  if (client) return

  console.log(`[im-service] 初始化 appkey=${APPKEY} server=${SERVER}`)

  client = JuggleIM.init({
    appkey: APPKEY,
    serverList: [SERVER],
    isSync: false,
  })

  // 连接状态变化
  client.on(Event.STATE_CHANGED, ({ state, code, extra }) => {
    const name = STATE_NAMES[state] || `未知(${state})`
    if (state === ConnectionState.DISCONNECTED) {
      console.log(`[im-service] 连接状态 ${name}`, { code, extra })
    } else {
      console.log(`[im-service] 连接状态 ${name}`, code ? `(code=${code})` : '')
    }
  })
}

/**
 * 使用 token 连接 IM 服务
 * @param {string} token - 登录后获取的 token
 */
async function connect(token) {
  if (!client) {
    throw new Error('im-service: 请先调用 init()')
  }

  console.log('[im-service] 正在连接 IM 服务...')
  try {
    currentUser = await client.connect({ token })
    console.log('[im-service] 登录成功，用户 ID:', currentUser?.id || currentUser?.userId || 'unknown')
    return currentUser
  } catch (err) {
    console.error('[im-service] 登录失败:', err?.message || err)
    throw err
  }
}

/**
 * 获取当前登录用户
 */
function getCurrentUser() {
  return currentUser
}

/**
 * 注册消息回调
 * 每条非忽略消息会同时：①回调给 main.cjs（→ IPC 到渲染进程）②转发到业务服务
 * @param {function} callback - (message) => void
 */
function onMessage(callback) {
  if (!client) {
    console.warn('[im-service] onMessage: client 未初始化')
    return
  }

  client.on(Event.MESSAGE_RECEIVED, (message) => {
    const decision = shouldIgnoreMessage(message)
    if (decision.ignored) return

    logMessage(message)

    // 回调给 main.cjs → 通过 IPC 发给渲染进程
    if (typeof callback === 'function') {
      try {
        callback(message)
      } catch (err) {
        console.error('[im-service] callback 异常:', err?.message || err)
      }
    }

    // 同时转发到业务服务
    void forwardToAppServer(message)
  })
}

module.exports = { init, connect, getCurrentUser, onMessage, updateApiBaseUrl, ConnectionState }
