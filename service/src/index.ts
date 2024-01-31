import https from 'https'
import url from 'url'
import express from 'express'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import type { ChatMessage } from './chatgpt'
import type { RequestProps } from './types'
import { chatConfig, chatReplyProcess, currentModel } from './chatgpt'
import { auth } from './middleware/auth'
import { limiter } from './middleware/limiter'
import { isNotEmptyString } from './utils/is'

const app = express()
const router = express.Router()

app.use(express.static('public'))
app.use(express.json())
dayjs.extend(utc)
dayjs.extend(timezone)
app.all('*', (_, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'authorization, Content-Type')
  res.header('Access-Control-Allow-Methods', '*')
  next()
})

router.post('/chat-process', [auth, limiter], async (req, res) => {
  res.setHeader('Content-type', 'application/octet-stream')

  try {
    const { prompt, options = {}, systemMessage, temperature, top_p } = req.body as RequestProps
    let firstChunk = true
    await chatReplyProcess({
      message: prompt,
      lastContext: options,
      process: (chat: ChatMessage) => {
        res.write(firstChunk ? JSON.stringify(chat) : `\n${JSON.stringify(chat)}`)
        firstChunk = false
      },
      systemMessage,
      temperature,
      top_p,
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
  const date = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss')
	let desc: string
	if(req.body.msg.length>10){
		desc=req.body.msg.substring(0,10)+"..."
	}else{
		desc=req.body.msg
	}
  const msg = { token: pushKey, content: `${req.body.msg}\n${date}\n${ip}`,title: 'chat推送',description:desc}
  const { hostname } = new url.URL(pushUrl)
  const options = {
    hostname,
    path: '/push/luck',
    method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
  }
	let data: string
  const request = https.request(options, (res) => {
		res.on('data', (chunk) => {
			data += chunk
		})
		res.on('end', () => {
			console.log("推送内容and结果：\n"+msg+`\n`+data)
		}
	)

	})
  request.write(JSON.stringify(msg))
  request.end()
  res.send({ status: 'Success', message: data })
})

router.post('/config', auth, async (req, res) => {
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
    const hasAuth = isNotEmptyString(AUTH_SECRET_KEY)
    res.send({ status: 'Success', message: '', data: { auth: hasAuth, model: currentModel() } })
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
app.set('trust proxy', 1)

app.listen(3002, () => globalThis.console.log('服务运行端口为：3002'))
