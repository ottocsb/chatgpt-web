import https from 'https'
import url from 'url'
import express from 'express'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import 'dayjs/plugin/utc'
import type { ChatContext, ChatMessage } from './chatgpt'
import { chatConfig, chatReplyProcess } from './chatgpt'
import { auth } from './middleware/auth'

const app = express()
const router = express.Router()

app.use(express.static('public'))
app.use(express.json())
dayjs().locale('zh-cn')
dayjs().utcOffset(8)
app.all('*', (_, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'authorization, Content-Type')
  res.header('Access-Control-Allow-Methods', '*')
  next()
})

router.post('/chat-process', auth, async (req, res) => {
  res.setHeader('Content-type', 'application/octet-stream')

  try {
    const { prompt, options = {} } = req.body as { prompt: string; options?: ChatContext }
    let firstChunk = true
    await chatReplyProcess(prompt, options, (chat: ChatMessage) => {
      res.write(firstChunk ? JSON.stringify(chat) : `\n${JSON.stringify(chat)}`)
      firstChunk = false
    })
  }
  catch (error) {
    res.write(JSON.stringify(error))
  }
  finally {
    res.end()
  }
})

router.post('/pushMsg', async (req, res) => {
  // 记录请求日志
  const pushKey = process.env.PUSH_KEY
  const pushUrl = process.env.PUSH_URL
  if (!pushKey && !pushUrl)
    throw new Error('Push key not found in environment variables')
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
  const date = dayjs().format('YYYY-MM-DD HH:mm:ss')
  const msg = { key: pushKey, msg: `${req.body.msg}\n${date}\n${ip}` }
  const { hostname } = new url.URL(pushUrl)
  const options = {
    hostname,
    method: 'POST',
  }
  const request = https.request(options)
  request.write(JSON.stringify(msg))
  request.end()
  res.send({ status: 'Success', message: '推送成功' })
})

router.post('/config', async (req, res) => {
  try {
    const response = await chatConfig()
    res.send(response)
  }
  catch (error) {
    res.send(error)
  }
})

router.post('/session', async (req, res) => {
  try {
    const AUTH_SECRET_KEY = process.env.AUTH_SECRET_KEY
    const hasAuth = typeof AUTH_SECRET_KEY === 'string' && AUTH_SECRET_KEY.length > 0
    res.send({ status: 'Success', message: '', data: { auth: hasAuth } })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body as { token: string }
    if (!token)
      throw new Error('Secret key is empty')

    if (process.env.AUTH_SECRET_KEY !== token)
      throw new Error('密钥无效 | Secret key is invalid')

    res.send({ status: 'Success', message: 'Verify successfully', data: null })
  }
  catch (error) {
    res.send({ status: 'Fail', message: error.message, data: null })
  }
})

app.use('', router)
app.use('/api', router)

app.listen(3002, () => globalThis.console.log('Server is running on port 3002'))
