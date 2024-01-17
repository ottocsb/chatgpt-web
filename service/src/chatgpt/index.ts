import * as dotenv from 'dotenv'
import 'isomorphic-fetch'
import type {ChatGPTAPIOptions, ChatMessage, SendMessageOptions} from 'chatgpt'
import {ChatGPTAPI, ChatGPTUnofficialProxyAPI} from 'chatgpt'
import {SocksProxyAgent} from 'socks-proxy-agent'
// import httpsProxyAgent from 'https-proxy-agent'
import fetch from 'node-fetch'
import {sendResponse} from '../utils'
import {isNotEmptyString} from '../utils/is'
import type {ApiModel, ChatContext, ChatGPTUnofficialProxyAPIOptions, ModelConfig} from '../types'
import type {RequestOptions, SetProxyOptions, UsageResponse} from './types'

// const { HttpsProxyAgent } = httpsProxyAgent

dotenv.config()

const ErrorCodeMessage: Record<string, string> = {
	401: '[OpenAI] 提供错误的API密钥 | Incorrect API key provided',
	403: '[OpenAI] 服务器拒绝访问，请稍后再试 | Server refused to access, please try again later',
	502: '[OpenAI] 错误的网关 |  Bad Gateway',
	503: '[OpenAI] 服务器繁忙，请稍后再试 | Server is busy, please try again later',
	504: '[OpenAI] 网关超时 | Gateway Time-out',
	500: '[OpenAI] 服务器繁忙，请稍后再试 | Internal Server Error',
}

const timeoutMs: number = !isNaN(+process.env.TIMEOUT_MS) ? +process.env.TIMEOUT_MS : 100 * 1000
const disableDebug: boolean = process.env.OPENAI_API_DISABLE_DEBUG === 'true'

let apiModel: ApiModel

const model = isNotEmptyString(process.env.OPENAI_API_MODEL) ? process.env.OPENAI_API_MODEL : 'gpt-3.5-turbo'

if (!isNotEmptyString(process.env.OPENAI_API_KEY) && !isNotEmptyString(process.env.OPENAI_ACCESS_TOKEN))
	throw new Error('Missing OPENAI_API_KEY or OPENAI_ACCESS_TOKEN environment variable')

let api: ChatGPTAPI | ChatGPTUnofficialProxyAPI

(async () => {
	const option: ChatGPTAPIOptions = {
		apiKey: 'sk-79a0acfc43a147b1e7e05a42f28f105d',
		completionParams: {model},
		apiBaseUrl: 'https://api.baichuan-ai.com/v1',
		debug: !disableDebug,

	}

	api = new ChatGPTAPI({...option})

	apiModel = 'ChatGPTAPI'

	console.log('options', option)

})()

async function chatReplyProcess(options: RequestOptions) {
	const {message, lastContext, process, systemMessage, temperature, top_p, knowledge_base} = options
	try {


		let options: any = {timeoutMs}

		if (apiModel === 'ChatGPTAPI') {
			if (isNotEmptyString(systemMessage))
				options.systemMessage = systemMessage
			options.completionParams = {model, temperature, top_p, knowledge_base}
		}

		if (lastContext != null) {
			if (apiModel === 'ChatGPTAPI')
				options.parentMessageId = lastContext.parentMessageId
			else
				options = {...lastContext}
		}

		console.log("api:", api)

		const response = await api.sendMessage(message, {
			...options,
			onProgress: (partialResponse) => {
				process?.(partialResponse)
			},
		})


		return sendResponse({type: 'Success', data: response})
	} catch (error: any) {
		const code = error.statusCode
		global.console.log('错误：', error.toString())
		if (Reflect.has(ErrorCodeMessage, code))
			return sendResponse({type: 'Fail', message: ErrorCodeMessage[code]})
		return sendResponse({type: 'Fail', message: error.message ?? 'Please check the back-end console'})
	}
}

async function fetchUsage() {
	const OPENAI_API_KEY = process.env.OPENAI_API_KEY
	const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL

	console.log('key', OPENAI_API_KEY)
	if (!isNotEmptyString(OPENAI_API_KEY))
		return Promise.resolve('-')

	const API_BASE_URL = isNotEmptyString(OPENAI_API_BASE_URL)
		? OPENAI_API_BASE_URL
		: 'https://api.openai.com'

	const [startDate, endDate] = formatDate()

	// 每月使用量
	const urlUsage = `${API_BASE_URL}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`

	const headers = {
		'Authorization': `Bearer ${OPENAI_API_KEY}`,
		'Content-Type': 'application/json',
	}

	const options = {} as SetProxyOptions


	try {
		// 获取已使用量
		const useResponse = await options.fetch(urlUsage, {headers})
		if (!useResponse.ok)
			throw new Error('获取使用量失败')
		const usageData = await useResponse.json() as UsageResponse
		const usage = Math.round(usageData.total_usage) / 100
		return Promise.resolve(usage ? `$${usage}` : '-')
	} catch (error) {
		global.console.log(error)
		return Promise.resolve('-')
	}
}

function formatDate(): string[] {
	const today = new Date()
	const year = today.getFullYear()
	const month = today.getMonth() + 1
	const lastDay = new Date(year, month, 0)
	const formattedFirstDay = `${year}-${month.toString().padStart(2, '0')}-01`
	const formattedLastDay = `${year}-${month.toString().padStart(2, '0')}-${lastDay.getDate().toString().padStart(2, '0')}`
	return [formattedFirstDay, formattedLastDay]
}

async function chatConfig() {
	const usage = await fetchUsage()
	const reverseProxy = process.env.API_REVERSE_PROXY ?? '-'
	const httpsProxy = (process.env.HTTPS_PROXY || process.env.ALL_PROXY) ?? '-'
	const socksProxy = (process.env.SOCKS_PROXY_HOST && process.env.SOCKS_PROXY_PORT)
		? (`${process.env.SOCKS_PROXY_HOST}:${process.env.SOCKS_PROXY_PORT}`)
		: '-'
	return sendResponse<ModelConfig>({
		type: 'Success',
		data: {apiModel, reverseProxy, timeoutMs, socksProxy, httpsProxy, usage},
	})
}


function currentModel(): ApiModel {
	return apiModel
}

export type {ChatContext, ChatMessage}

export {chatReplyProcess, chatConfig, currentModel}
