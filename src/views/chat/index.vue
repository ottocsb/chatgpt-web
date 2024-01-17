<script setup lang = 'ts'>
import type {Ref} from 'vue'
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {useRoute} from 'vue-router'
import {NButton, NInput, NPopselect, NUpload, useDialog, useMessage} from 'naive-ui'
import html2canvas from 'html2canvas'
import {Message} from './components'
import {useScroll} from './hooks/useScroll'
import {useChat} from './hooks/useChat'
import {useUsingContext} from './hooks/useUsingContext'
import HeaderComponent from './components/Header/index.vue'
import {HoverButton, SvgIcon} from '@/components/common'
import {useBasicLayout} from '@/hooks/useBasicLayout'
import {useChatStore} from '@/store'
import {fetchChatAPIProcess} from '@/api'
import {t} from '@/locales'
import axios from "axios";

let controller = new AbortController()

const openLongReply = import.meta.env.VITE_GLOB_OPEN_LONG_REPLY === 'true'

const route = useRoute()
const dialog = useDialog()
const ms = useMessage()

const chatStore = useChatStore()

const {isMobile} = useBasicLayout()
const {addChat, updateChat, updateChatSome, getChatByUuidAndIndex} = useChat()
const {scrollRef, scrollToBottom, scrollToBottomIfAtBottom} = useScroll()
const {usingContext} = useUsingContext()

const {uuid} = route.params as { uuid: string }

const dataSources = computed(() => chatStore.getChatByUuid(+uuid))
const conversationList = computed(() => dataSources.value.filter(item => (!item.inversion && !!item.conversationOptions)))

const prompt = ref<string>('')
const loading = ref<boolean>(false)
const inputRef = ref<Ref | null>(null)

// 未知原因刷新页面，loading 状态不会重置，手动重置
dataSources.value.forEach((item, index) => {
	if (item.loading)
		updateChatSome(+uuid, index, {loading: false})
})

function handleSubmit() {
	onConversation()
}

async function onConversation() {
	let message = prompt.value
	if (loading.value)
		return

	if (!message || message.trim() === '')
		return

	controller = new AbortController()

	addChat(
		+uuid,
		{
			dateTime: new Date().toLocaleString(),
			text: message,
			inversion: true,
			error: false,
			conversationOptions: null,
			requestOptions: {prompt: message, options: null},
		},
	)
	await scrollToBottom()

	loading.value = true
	prompt.value = ''

	let options: Chat.ConversationRequest = {}
	const lastContext = conversationList.value[conversationList.value.length - 1]?.conversationOptions
	let knowledge_base = {ids: selected.value}

	if (lastContext && usingContext.value)
		options = {...lastContext}

	addChat(
		+uuid,
		{
			dateTime: new Date().toLocaleString(),
			text: t('chat.thinking'),
			loading: true,
			inversion: false,
			error: false,
			conversationOptions: null,
			requestOptions: {prompt: message, options: {...options}},
		},
	)
	await scrollToBottom()

	try {
		let lastText = ''
		const fetchChatAPIOnce = async () => {
			await fetchChatAPIProcess<Chat.ConversationResponse>({
				prompt: message,
				options,
				knowledge_base,
				signal: controller.signal,
				onDownloadProgress: ({event}) => {
					const xhr = event.target
					const {responseText} = xhr
					// Always process the final line
					const lastIndex = responseText.lastIndexOf('\n', responseText.length - 2)
					let chunk = responseText
					if (lastIndex !== -1)
						chunk = responseText.substring(lastIndex)
					try {
						const data = JSON.parse(chunk)
						updateChat(
							+uuid,
							dataSources.value.length - 1,
							{
								dateTime: new Date().toLocaleString(),
								text: lastText + (data.text ?? ''),
								inversion: false,
								error: false,
								loading: true,
								conversationOptions: {conversationId: data.conversationId, parentMessageId: data.id},
								requestOptions: {prompt: message, options: {...options}},
							},
						)

						if (openLongReply && data.detail.choices[0].finish_reason === 'length') {
							options.parentMessageId = data.id
							lastText = data.text
							message = ''
							return fetchChatAPIOnce()
						}

						scrollToBottomIfAtBottom()
					} catch (error) {
						//
					}
				},
			})
			updateChatSome(+uuid, dataSources.value.length - 1, {loading: false})
		}

		await fetchChatAPIOnce()
	} catch (error: any) {
		const errorMessage = error?.message ?? t('common.wrong')

		if (error.message === 'canceled') {
			updateChatSome(
				+uuid,
				dataSources.value.length - 1,
				{
					loading: false,
				},
			)
			await scrollToBottomIfAtBottom()
			return
		}

		const currentChat = getChatByUuidAndIndex(+uuid, dataSources.value.length - 1)

		if (currentChat?.text && currentChat.text !== '') {
			updateChatSome(
				+uuid,
				dataSources.value.length - 1,
				{
					text: `${currentChat.text}\n[${errorMessage}]`,
					error: false,
					loading: false,
				},
			)
			return
		}

		updateChat(
			+uuid,
			dataSources.value.length - 1,
			{
				dateTime: new Date().toLocaleString(),
				text: errorMessage,
				inversion: false,
				error: true,
				loading: false,
				conversationOptions: null,
				requestOptions: {prompt: message, options: {...options}},
			},
		)
		await scrollToBottomIfAtBottom()
	} finally {
		loading.value = false
	}
}

async function onRegenerate(index: number) {
	if (loading.value)
		return

	controller = new AbortController()

	const {requestOptions} = dataSources.value[index]

	let message = requestOptions?.prompt ?? ''

	let options: Chat.ConversationRequest = {}

	if (requestOptions.options)
		options = {...requestOptions.options}

	loading.value = true

	updateChat(
		+uuid,
		index,
		{
			dateTime: new Date().toLocaleString(),
			text: '',
			inversion: false,
			error: false,
			loading: true,
			conversationOptions: null,
			requestOptions: {prompt: message, options: {...options}},
		},
	)

	let knowledge_base = {ids: selected.value}
	try {
		let lastText = ''
		const fetchChatAPIOnce = async () => {
			await fetchChatAPIProcess<Chat.ConversationResponse>({
				prompt: message,
				options,
				knowledge_base,
				signal: controller.signal,
				onDownloadProgress: ({event}) => {
					const xhr = event.target
					const {responseText} = xhr
					// Always process the final line
					const lastIndex = responseText.lastIndexOf('\n', responseText.length - 2)
					let chunk = responseText
					if (lastIndex !== -1)
						chunk = responseText.substring(lastIndex)
					try {
						const data = JSON.parse(chunk)
						updateChat(
							+uuid,
							index,
							{
								dateTime: new Date().toLocaleString(),
								text: lastText + (data.text ?? ''),
								inversion: false,
								error: false,
								loading: true,
								conversationOptions: {conversationId: data.conversationId, parentMessageId: data.id},
								requestOptions: {prompt: message, options: {...options}},
							},
						)

						if (openLongReply && data.detail.choices[0].finish_reason === 'length') {
							options.parentMessageId = data.id
							lastText = data.text
							message = ''
							return fetchChatAPIOnce()
						}
					} catch (error) {
						//
					}
				},
			})
			updateChatSome(+uuid, index, {loading: false})
		}
		await fetchChatAPIOnce()
	} catch (error: any) {
		if (error.message === 'canceled') {
			updateChatSome(
				+uuid,
				index,
				{
					loading: false,
				},
			)
			return
		}

		const errorMessage = error?.message ?? t('common.wrong')

		updateChat(
			+uuid,
			index,
			{
				dateTime: new Date().toLocaleString(),
				text: errorMessage,
				inversion: false,
				error: true,
				loading: false,
				conversationOptions: null,
				requestOptions: {prompt: message, options: {...options}},
			},
		)
	} finally {
		loading.value = false
	}
}

function handleExport() {
	if (loading.value)
		return

	const d = dialog.warning({
		title: t('chat.exportImage'),
		content: t('chat.exportImageConfirm'),
		positiveText: t('common.yes'),
		negativeText: t('common.no'),
		onPositiveClick: async () => {
			try {
				d.loading = true
				const ele = document.getElementById('image-wrapper')
				const canvas = await html2canvas(ele as HTMLDivElement, {
					useCORS: true,
				})
				const imgUrl = canvas.toDataURL('image/png')
				const tempLink = document.createElement('a')
				tempLink.style.display = 'none'
				tempLink.href = imgUrl
				tempLink.setAttribute('download', 'chat-shot.png')
				if (typeof tempLink.download === 'undefined')
					tempLink.setAttribute('target', '_blank')

				document.body.appendChild(tempLink)
				tempLink.click()
				document.body.removeChild(tempLink)
				window.URL.revokeObjectURL(imgUrl)
				d.loading = false
				ms.success(t('chat.exportSuccess'))
				await Promise.resolve()
			} catch (error: any) {
				ms.error(t('chat.exportFailed'))
			} finally {
				d.loading = false
			}
		},
	})
}

function handleDelete(index: number) {
	if (loading.value)
		return

	dialog.warning({
		title: t('chat.deleteMessage'),
		content: t('chat.deleteMessageConfirm'),
		positiveText: t('common.yes'),
		negativeText: t('common.no'),
		onPositiveClick: () => {
			chatStore.deleteChatByUuid(+uuid, index)
		},
	})
}

function handleClear() {
	if (loading.value)
		return

	dialog.warning({
		title: t('chat.clearChat'),
		content: t('chat.clearChatConfirm'),
		positiveText: t('common.yes'),
		negativeText: t('common.no'),
		onPositiveClick: () => {
			chatStore.clearChatByUuid(+uuid)
		},
	})
}

function handleEnter(event: KeyboardEvent) {
	if (!isMobile.value) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault()
			handleSubmit()
		}
	} else {
		if (event.key === 'Enter' && event.ctrlKey) {
			event.preventDefault()
			handleSubmit()
		}
	}
}

function handleStop() {
	if (loading.value) {
		controller.abort()
		loading.value = false
	}
}

const placeholder = computed(() => {
	if (isMobile.value)
		return t('chat.placeholderMobile')
	return t('chat.placeholder')
})

const buttonDisabled = computed(() => {
	return loading.value || !prompt.value || prompt.value.trim() === ''
})

const footerClass = computed(() => {
	let classes = ['p-4']
	if (isMobile.value)
		classes = ['sticky', 'left-0', 'bottom-0', 'right-0', 'p-2', 'pr-3', 'overflow-hidden']
	return classes
})

const bcKey = 'Bearer sk-79a0acfc43a147b1e7e05a42f28f105d'

let debounceTimer;

const getFile = () => {
	clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		axios.get('https://api.baichuan-ai.com/v1/kbs', {
			headers: {
				Authorization: bcKey
			}
		}).then(res => {
			console.log(res.data)
			option.value = res.data.data.map((item: any) => {

				// 公司介绍知识库不可取消
				if(item.id=='kb-P7d1519WzMO7izDXL0xmy1AN'){
					return {
						label: item.name,
						value: item.id,
						disabled: true
					}
				}

				let status = item.status == 'online'

				return {
					label: item.name,
					value: item.id,
					disabled: !status
				}
			})
		})

	}, 500);
}


function extractMatches(text: string): string {
	let regex = new RegExp("[\u4E00-\u9FA5A-Za-z0-9_]{1,50}", "g");
	const matches = text.match(regex);
	return matches ? matches.join('') : '';
}

const beforeUpload = (file: any) => {
	let size = file.file.file.size / 1024 / 1024
	if (size > 50) {
		ms.error('文件大小不能超过50M')
		return false
	}
}

const onFinish = (res: any) => {
	let response = JSON.parse(res.event?.target?.responseText)
	console.log(response)
	ms.loading('上传成功,稍等正在解析文件中...')

	let fileName = extractMatches(response.filename)
	console.log(fileName)

	axios.post('https://api.baichuan-ai.com/v1/kbs', {
		name: fileName,
		split_type: 1
	}, {
		headers: {
			Authorization: bcKey
		}
	}).then(res => {
		console.log("创建对应知识库成功", res.data)
		ms.success('创建对应知识库成功')
		let url = 'https://api.baichuan-ai.com/v1/kbs/' + res.data.id + '/files'
		axios.post(url, {
			file_ids: [response.id]
		}, {
			headers: {
				Authorization: bcKey
			}
		}).then(res => {
			console.log('关联成功', res.data)
			ms.success('关联成功')
		})

	})
}

let option = ref([])
// 固定知识库为理琪公司介绍相关内容
let selected = ref(['kb-P7d1519WzMO7izDXL0xmy1AN'])

onMounted(() => {
	scrollToBottom()
	if (inputRef.value && !isMobile.value)
		inputRef.value?.focus()
})

onUnmounted(() => {
	if (loading.value)
		controller.abort()
})
</script>

<template>
	<div class = "flex flex-col w-full h-full">
		<HeaderComponent
			v-if = "isMobile"
			:using-context = "usingContext"
			@export = "handleExport"
			@handle-clear = "handleClear"
		/>
		<main class = "flex-1 overflow-hidden">
			<div id = "scrollRef" ref = "scrollRef" class = "h-full overflow-hidden overflow-y-auto">
				<div
					id = "image-wrapper"
					class = "w-full max-w-screen-xl m-auto dark:bg-[#101014]"
					:class = "[isMobile ? 'p-2' : 'p-4']"
				>
					<template v-if = "!dataSources.length">
						<div class = "flex items-center justify-center mt-4 text-center text-neutral-300">
							<SvgIcon icon = "ri:bubble-chart-fill" class = "mr-2 text-3xl"/>
							<span>{{ t('chat.newChatTitle') }}</span>
						</div>
					</template>
					<template v-else>
						<div>
							<Message
								v-for = "(item, index) of dataSources"
								:key = "index"
								:date-time = "item.dateTime"
								:text = "item.text"
								:inversion = "item.inversion"
								:error = "item.error"
								:loading = "item.loading"
								@regenerate = "onRegenerate(index)"
								@delete = "handleDelete(index)"
							/>
							<div class = "sticky bottom-0 left-0 flex justify-center">
								<NButton v-if = "loading" type = "warning" @click = "handleStop">
									<template #icon>
										<SvgIcon icon = "ri:stop-circle-line"/>
									</template>
									{{ t('common.stopResponding') }}
								</NButton>
							</div>
						</div>
					</template>
				</div>
			</div>
		</main>
		<footer :class = "footerClass">
			<div class = "w-full max-w-screen-xl m-auto">
				<div class = "flex items-center justify-between space-x-2">
					<HoverButton v-if = "!isMobile">
						<span class = "text-xl text-[#4f555e] dark:text-white">
							<NPopselect :options = "option" v-model:value = "selected" multiple>
								<SvgIcon icon = "ri:folder-received-line" @mouseover = "getFile" class = "mt-1"/>
							</NPopselect>
						</span>
					</HoverButton>
					<HoverButton v-if = "!isMobile">
						<span class = "text-xl text-[#4f555e] dark:text-white">
							<NUpload
								action = "https://api.baichuan-ai.com/v1/files"
								:headers = "{Authorization: bcKey}"
								:data = "{purpose: 'knowledge-base'}"
								:accept = "['.doc', '.docx', '.pdf', '.txt']"
								@finish = "onFinish"
								@before-upload = "beforeUpload"
								:show-file-list = "false"
							>
								<SvgIcon icon = "ri:file-upload-line" class = "mt-2"/>
							</NUpload>
						</span>
					</HoverButton>
					<HoverButton v-if = "!isMobile" @click = "handleClear">
            <span class = "text-xl text-[#4f555e] dark:text-white">
              <SvgIcon icon = "ri:delete-bin-line"/>
            </span>
					</HoverButton>
					<HoverButton v-if = "!isMobile" @click = "handleExport">
            <span class = "text-xl text-[#4f555e] dark:text-white">
              <SvgIcon icon = "ri:download-2-line"/>
            </span>
					</HoverButton>
					<NInput
						ref = "inputRef"
						v-model:value = "prompt"
						type = "textarea"
						:placeholder = "placeholder"
						:autosize = "{ minRows: 1, maxRows: isMobile ? 4 : 8 }"
						@keypress = "handleEnter"
					/>
					<NButton type = "primary" :disabled = "buttonDisabled" @click = "handleSubmit">
						<template #icon>
              <span class = "dark:text-black">
                <SvgIcon icon = "ri:send-plane-fill"/>
              </span>
						</template>
					</NButton>
				</div>
			</div>
		</footer>
	</div>
</template>
