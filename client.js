/**
 * Browser half of conversation-find.
 *
 * Ctrl/Cmd+F in the conversation window opens a small find bar over the
 * transcript. The search runs over the rendered text nodes of the loaded
 * conversation window: messages, Markdown, code blocks, and visible tool
 * details. It never asks the Host for history, so the result set grows as the
 * user loads earlier turns from the bar.
 *
 * The bar is a plain DOM overlay appended to `document.body`, positioned from
 * the conversation content's rect. Matches use the CSS Custom Highlight API,
 * with the current match in a separate, stronger highlight.
 */

window.__ModuleLoader__.load({
  id: 'dsh-conversation-find',
  factory() {
    const TAG = 'conversation-find'
    const NS = 'conversationFind'
    const FIND_DEBOUNCE = 120
    const FIND_MAX_MATCHES = 2000
    const FIND_ALL_HIGHLIGHT = 'dsh-conversation-find'
    const FIND_CURRENT_HIGHLIGHT = 'dsh-conversation-find-current'
    const SKIP_TEXT_ANCESTORS = [
      'button',
      'script',
      'style',
      '[hidden]',
      '[aria-hidden="true"]',
      '[data-text-interaction-exclude]',
      '[data-composer-seat]',
      '[data-conversation-region="composer"]',
    ].join(',')

    const zh = {
      placeholder: '在会话中查找',
      previous: '上一个匹配',
      next: '下一个匹配',
      close: '关闭查找',
      caseSensitive: '区分大小写',
      wholeWord: '全字匹配',
      regex: '使用正则表达式',
      invalid: '正则无效',
      partial: '部分',
      loadOlder: '只搜索了已加载的会话，点击加载更早的消息',
      capped: '仅显示前 {count} 个匹配',
    }
    const en = {
      placeholder: 'Find in conversation',
      previous: 'Previous match',
      next: 'Next match',
      close: 'Close find',
      caseSensitive: 'Match Case',
      wholeWord: 'Match Whole Word',
      regex: 'Use Regular Expression',
      invalid: 'Invalid regex',
      partial: 'Partial',
      loadOlder: 'Only loaded messages are searched; click to load earlier history',
      capped: 'Showing the first {count} matches only',
    }

    /** Escape a literal query before it becomes a regular expression. */
    function escapeRegExp(text) {
      return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    /** Compile one find matcher; the caller resets `lastIndex` per search. */
    function compileMatcher(query, options) {
      const source = options.regex ? query : escapeRegExp(query)
      const pattern = options.wholeWord
        ? `(?<![\\p{L}\\p{N}_$])(?:${source})(?![\\p{L}\\p{N}_$])`
        : source
      return new RegExp(pattern, `g${options.caseSensitive ? '' : 'i'}u`)
    }

    function isEditableElement(element) {
      if (!(element instanceof Element)) return false
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true
      return element.isContentEditable || element.closest('[contenteditable="true"]') !== null
    }

    function visibleElement(element) {
      if (!(element instanceof Element) || !element.isConnected) return false
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }

    /**
     * The text nodes of the loaded conversation, in document order, with their
     * offsets in the concatenated search string.
     */
    function textPiecesOf(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const text = node.nodeValue
          if (text === null || text === '') return NodeFilter.FILTER_REJECT
          const parent = node.parentElement
          if (parent === null) return NodeFilter.FILTER_REJECT
          if (parent.closest(SKIP_TEXT_ANCESTORS) !== null) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      const pieces = []
      let length = 0
      let node
      while ((node = walker.nextNode()) !== null) {
        const text = node.nodeValue ?? ''
        pieces.push({ node, start: length, end: length + text.length, text })
        length += text.length
      }
      return pieces
    }

    /** The text node holding an offset, by binary search. */
    function pieceAtOffset(pieces, offset, endSide) {
      let low = 0
      let high = pieces.length - 1
      let found
      while (low <= high) {
        const middle = (low + high) >> 1
        const piece = pieces[middle]
        const qualifies = endSide ? piece.end >= offset : piece.end > offset
        if (qualifies) {
          found = piece
          high = middle - 1
        } else {
          low = middle + 1
        }
      }
      return found
    }

    /** Collect match ranges over one search root. */
    function findMatchesIn(root, matcher) {
      const pieces = textPiecesOf(root)
      if (pieces.length === 0) return { matches: [], capped: false }
      const text = pieces.map(piece => piece.text).join('')
      const matches = []
      let capped = false
      matcher.lastIndex = 0
      let match
      while ((match = matcher.exec(text)) !== null) {
        if (match[0] === '') {
          matcher.lastIndex += 1
          continue
        }
        const start = match.index
        const end = start + match[0].length
        const startPiece = pieceAtOffset(pieces, start, false)
        const endPiece = pieceAtOffset(pieces, end, true)
        if (startPiece !== undefined && endPiece !== undefined) {
          const range = document.createRange()
          range.setStart(startPiece.node, start - startPiece.start)
          range.setEnd(endPiece.node, end - endPiece.start)
          matches.push({ start, end, range })
        }
        if (matches.length >= FIND_MAX_MATCHES) {
          capped = true
          break
        }
      }
      return { matches, capped }
    }

    function selectedTextIn(root) {
      const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
      if (selection === null || selection === undefined || selection.isCollapsed || selection.rangeCount === 0) return ''
      const range = selection.getRangeAt(0)
      if (!root.contains(range.commonAncestorContainer)) return ''
      const text = selection.toString()
      if (text === '' || text.length > 200 || /[\r\n]/.test(text)) return ''
      return text
    }

    function conversationFromSelection() {
      const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
      if (selection === null || selection === undefined || selection.rangeCount === 0) return null
      const node = selection.anchorNode
      if (node === null) return null
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
      if (!(element instanceof Element)) return null
      if (element.closest('[data-composer-seat]') !== null) return null
      const content = element.closest('[data-conversation-content]')
      return content !== null && visibleElement(content) ? content : null
    }

    /**
     * The "Load earlier" control, when earlier history remains. The control is
     * a direct button row before the chat flow slot; the loading/error rows
     * before it carry no button.
     */
    function olderButtonOf(scroller) {
      if (!(scroller instanceof Element)) return null
      const flow = scroller.querySelector('[data-chat-flow]')
      if (flow === null) return null
      const slot = flow.querySelector(':scope > [data-slot="conversation.chat.flow"]')
      for (const child of flow.children) {
        if (child === slot) break
        const button = child.querySelector(':scope > button')
        if (button !== null) return button
      }
      return null
    }

    function toolButton(label, text) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dcf-tool'
      button.textContent = text
      button.title = label
      button.setAttribute('aria-label', label)
      return button
    }

    function toggleButton(text, label) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dcf-toggle'
      button.textContent = text
      button.title = label
      button.setAttribute('aria-label', label)
      button.setAttribute('aria-pressed', 'false')
      return button
    }

    function buildFindBar(t) {
      const bar = document.createElement('div')
      bar.setAttribute('data-conversation-find', '')
      bar.setAttribute('role', 'search')
      const top = document.createElement('div')
      top.className = 'dcf-top'
      const input = document.createElement('input')
      input.className = 'dcf-input'
      input.type = 'text'
      input.placeholder = t('placeholder')
      input.setAttribute('aria-label', t('placeholder'))
      input.spellcheck = false
      input.autocomplete = 'off'
      const count = document.createElement('span')
      count.className = 'dcf-count'
      count.setAttribute('aria-live', 'polite')
      const previous = toolButton(t('previous'), '↑')
      const next = toolButton(t('next'), '↓')
      const close = toolButton(t('close'), '×')
      top.append(input, count, previous, next, close)
      const bottom = document.createElement('div')
      bottom.className = 'dcf-bottom'
      const caseButton = toggleButton('Aa', t('caseSensitive'))
      const wordButton = toggleButton('ab', t('wholeWord'))
      const regexButton = toggleButton('.*', t('regex'))
      const partial = document.createElement('button')
      partial.type = 'button'
      partial.className = 'dcf-partial'
      partial.textContent = t('partial')
      partial.title = t('loadOlder')
      partial.setAttribute('aria-label', t('loadOlder'))
      partial.hidden = true
      bottom.append(caseButton, wordButton, regexButton, partial)
      bar.append(top, bottom)
      return { bar, input, count, previous, next, close, caseButton, wordButton, regexButton, partial }
    }

    /**
     * Mount the conversation find surface.
     * @param {(key: string, params?: object) => string} t locale-bound translate.
     * @returns {() => void} disposer.
     */
    function install(t) {
      let find = null
      let lastContent = null

      const isFindOpenFor = (content) => find !== null && find.content === content

      const contentFor = element => {
        if (!(element instanceof Element)) return null
        const content = element.closest('[data-conversation-content]')
        if (content === null || !content.isConnected || !visibleElement(content)) return null
        if (element.closest('[data-composer-seat]') !== null) return null
        if (content.querySelector('[data-conversation-scroll]') === null) return null
        return content
      }

      const resolveContent = target => {
        const inBar = find !== null && target instanceof Node && find.bar.contains(target)
        if (inBar) return find.content
        const element = target instanceof Element
          ? target
          : document.activeElement instanceof Element ? document.activeElement : null
        if (element !== null) {
          if (isEditableElement(element) && !inBar) return null
          if (element.closest('[data-composer-seat]') !== null) return null
          const direct = contentFor(element)
          if (direct !== null) return direct
          if (element !== document.body && element !== document.documentElement) return null
        }
        const selectionContent = conversationFromSelection()
        if (selectionContent !== null) return selectionContent
        if (lastContent !== null && lastContent.isConnected && visibleElement(lastContent)) return lastContent
        return null
      }

      const clearHighlights = () => {
        if (typeof CSS !== 'undefined' && CSS.highlights !== undefined) {
          CSS.highlights.delete(FIND_ALL_HIGHLIGHT)
          CSS.highlights.delete(FIND_CURRENT_HIGHLIGHT)
        }
      }

      const applyHighlights = session => {
        if (find !== session) return
        if (typeof CSS !== 'undefined' && CSS.highlights !== undefined && typeof Highlight === 'function') {
          clearHighlights()
          if (session.matches.length === 0) return
          try {
            const all = new Highlight(...session.matches.map(match => match.range))
            all.priority = 1
            CSS.highlights.set(FIND_ALL_HIGHLIGHT, all)
            const current = session.matches[session.current]
            if (current !== undefined) {
              const selected = new Highlight(current.range)
              selected.priority = 2
              CSS.highlights.set(FIND_CURRENT_HIGHLIGHT, selected)
            }
            return
          } catch {
            /* fall through to the selection fallback */
          }
        }
        const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
        if (selection === null) return
        if (session.matches.length === 0) {
          if (session.usedSelection) {
            selection.removeAllRanges()
            session.usedSelection = false
          }
          return
        }
        const current = session.matches[session.current]
        if (current === undefined) return
        selection.removeAllRanges()
        selection.addRange(current.range.cloneRange())
        session.usedSelection = true
      }

      const position = session => {
        if (find !== session) return
        if (!session.content.isConnected || !visibleElement(session.content)) {
          close()
          return
        }
        if (session.sessionId !== '' && session.content.dataset.conversationSession !== session.sessionId) {
          close()
          return
        }
        const rect = session.content.getBoundingClientRect()
        if (rect.width < 120 || rect.height < 60) {
          close()
          return
        }
        const width = Math.max(220, Math.min(440, rect.width - 32))
        session.bar.style.width = `${width}px`
        const barRect = session.bar.getBoundingClientRect()
        const left = Math.max(8, Math.min(rect.right - width - 16, window.innerWidth - width - 8))
        const top = Math.max(8, Math.min(rect.top + 8, window.innerHeight - barRect.height - 8))
        session.bar.style.left = `${left}px`
        session.bar.style.top = `${top}px`
      }

      const updatePartial = session => {
        if (find !== session) return
        const older = olderButtonOf(session.scroller)
        session.partial.hidden = older === null
        session.partial.disabled = older === null || older.disabled === true
      }

      const updateState = session => {
        if (find !== session) return
        const bad = session.query !== '' && (session.invalid || session.matches.length === 0)
        session.bar.classList.toggle('is-invalid', bad)
        session.input.setAttribute('aria-invalid', bad ? 'true' : 'false')
        session.previous.disabled = session.matches.length === 0
        session.next.disabled = session.matches.length === 0
        if (session.query === '') {
          session.count.textContent = ''
          session.count.title = ''
          return
        }
        if (session.invalid) {
          session.count.textContent = t('invalid')
          session.count.title = session.invalidMessage
          return
        }
        if (session.matches.length === 0) {
          session.count.textContent = '0/0'
          session.count.title = ''
          return
        }
        session.count.textContent = `${session.current + 1}/${session.matches.length}${session.capped ? '+' : ''}`
        session.count.title = session.capped ? t('capped', { count: FIND_MAX_MATCHES }) : ''
      }

      const reveal = (session, index) => {
        const match = session.matches[index]
        if (match === undefined) return
        let rect
        try {
          rect = match.range.getBoundingClientRect()
        } catch {
          return
        }
        if (rect.width === 0 && rect.height === 0) return
        const scroller = session.scroller
        const box = scroller.getBoundingClientRect()
        if (rect.top < box.top + 8 || rect.bottom > box.bottom - 8) {
          scroller.scrollTop += rect.top - box.top - (scroller.clientHeight - rect.height) / 2
        }
        if (rect.left < box.left + 8 || rect.right > box.right - 8) {
          scroller.scrollLeft += rect.left - box.left - 24
        }
      }

      const close = () => {
        const session = find
        if (session === null) return
        find = null
        clearTimeout(session.timer)
        if (session.observer !== null) session.observer.disconnect()
        if (session.hostObserver !== null) session.hostObserver.disconnect()
        if (session.bodyObserver !== null) session.bodyObserver.disconnect()
        if (session.resizeObserver !== null) session.resizeObserver.disconnect()
        window.removeEventListener('resize', session.reposition)
        clearHighlights()
        if (session.usedSelection) {
          const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
          if (selection !== null) selection.removeAllRanges()
        }
        session.bar.remove()
      }

      const reobserve = session => {
        const scroller = session.content.querySelector('[data-conversation-scroll]')
        if (scroller === null) {
          close()
          return false
        }
        if (scroller !== session.scroller) {
          session.scroller = scroller
          session.root = scroller
          if (session.observer !== null) session.observer.disconnect()
          session.observer = observeConversation(session, scroller)
        }
        return true
      }

      const runSearch = (session, shouldReveal) => {
        if (find !== session) return
        clearTimeout(session.timer)
        session.timer = null
        if (!session.content.isConnected || !visibleElement(session.content)) {
          close()
          return
        }
        if (session.sessionId !== '' && session.content.dataset.conversationSession !== session.sessionId) {
          close()
          return
        }
        if (!session.scroller.isConnected && !reobserve(session)) return
        const query = session.input.value
        session.query = query
        if (query === '') {
          session.matches = []
          session.current = 0
          session.capped = false
          session.invalid = false
          session.invalidMessage = ''
          session.searchKey = null
          applyHighlights(session)
          updateState(session)
          return
        }
        const key = `${query}\u0000${session.caseSensitive}\u0000${session.wholeWord}\u0000${session.useRegex}`
        const preserve = key === session.searchKey && session.matches.length > 0
        const previous = preserve ? session.matches[session.current] : undefined
        const previousNode = previous === undefined ? undefined : previous.range.startContainer
        const previousOffset = previous === undefined ? undefined : previous.range.startOffset
        const previousStart = previous === undefined ? undefined : previous.start
        let matcher
        try {
          matcher = compileMatcher(query, {
            caseSensitive: session.caseSensitive,
            wholeWord: session.wholeWord,
            regex: session.useRegex,
          })
          session.invalid = false
          session.invalidMessage = ''
        } catch (error) {
          session.invalid = true
          session.invalidMessage = error instanceof Error ? error.message : String(error)
          session.matches = []
          session.current = 0
          session.capped = false
          session.searchKey = key
          applyHighlights(session)
          updateState(session)
          return
        }
        const result = findMatchesIn(session.scroller, matcher)
        session.matches = result.matches
        session.capped = result.capped
        session.searchKey = key
        let nextIndex = -1
        if (previousNode !== undefined) {
          nextIndex = session.matches.findIndex(match =>
            match.range.startContainer === previousNode && match.range.startOffset === previousOffset)
        }
        if (nextIndex < 0 && previousStart !== undefined) {
          nextIndex = session.matches.findIndex(match => match.start === previousStart)
        }
        session.current = nextIndex >= 0
          ? nextIndex
          : Math.min(session.current, Math.max(0, session.matches.length - 1))
        if (session.current < 0 || session.current >= session.matches.length) {
          session.current = Math.min(session.current, Math.max(0, session.matches.length - 1))
        }
        updatePartial(session)
        applyHighlights(session)
        updateState(session)
        if (shouldReveal && session.matches.length > 0) reveal(session, session.current)
      }

      const schedule = (session, shouldReveal) => {
        if (find !== session) return
        if (shouldReveal) session.pendingReveal = true
        clearTimeout(session.timer)
        session.timer = setTimeout(() => {
          session.timer = null
          const revealNow = session.pendingReveal === true
          session.pendingReveal = false
          runSearch(session, revealNow)
        }, FIND_DEBOUNCE)
      }

      const step = (session, delta) => {
        if (session.matches.length === 0) return
        session.current = (session.current + delta + session.matches.length) % session.matches.length
        applyHighlights(session)
        updateState(session)
        reveal(session, session.current)
        session.input.focus({ preventScroll: true })
      }

      const observeConversation = (session, scroller) => {
        let queued = false
        const queuePosition = () => {
          if (queued) return
          queued = true
          const run = () => {
            queued = false
            if (find === session) position(session)
          }
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
          else setTimeout(run, 0)
        }
        const observer = new MutationObserver(records => {
          if (find !== session) return
          const relevant = records.some(record => {
            const target = record.target instanceof Element ? record.target : record.target.parentElement
            return target === null || target.closest('[data-composer-seat]') === null
          })
          if (!relevant) return
          if (!session.content.isConnected || !visibleElement(session.content)) {
            close()
            return
          }
          if (session.sessionId !== '' && session.content.dataset.conversationSession !== session.sessionId) {
            close()
            return
          }
          if (!session.scroller.isConnected && !reobserve(session)) return
          queuePosition()
          updatePartial(session)
          schedule(session, false)
        })
        observer.observe(scroller, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['disabled', 'hidden'],
        })
        return observer
      }

      const open = content => {
        if (find !== null) close()
        const scroller = content.querySelector('[data-conversation-scroll]')
        if (scroller === null || textPiecesOf(scroller).length === 0) return false
        const built = buildFindBar(t)
        const sessionId = content.dataset.conversationSession ?? ''
        const session = {
          content,
          scroller,
          root: scroller,
          sessionId,
          ...built,
          matches: [],
          current: 0,
          query: '',
          searchKey: null,
          capped: false,
          invalid: false,
          invalidMessage: '',
          usedSelection: false,
          pendingReveal: false,
          timer: null,
          observer: null,
          hostObserver: null,
          bodyObserver: null,
          resizeObserver: null,
          reposition: null,
        }
        find = session
        document.body.appendChild(session.bar)
        session.reposition = () => position(session)
        window.addEventListener('resize', session.reposition, { passive: true })
        if (typeof ResizeObserver === 'function') {
          session.resizeObserver = new ResizeObserver(session.reposition)
          session.resizeObserver.observe(content)
        }
        if (typeof MutationObserver === 'function') {
          session.observer = observeConversation(session, scroller)
          session.hostObserver = new MutationObserver(() => {
            if (find !== session) return
            if (!content.isConnected || !visibleElement(content)) {
              close()
              return
            }
            if (sessionId !== '' && content.dataset.conversationSession !== sessionId) {
              close()
              return
            }
            if (!session.scroller.isConnected) reobserve(session)
            else {
              session.reposition()
              schedule(session, false)
            }
          })
          session.hostObserver.observe(content, {
            childList: true,
            attributes: true,
            attributeFilter: ['data-conversation-session'],
          })
          session.bodyObserver = new MutationObserver(() => {
            if (find !== session) return
            if (!content.isConnected || !visibleElement(content)) close()
          })
          const parent = content.parentElement ?? document.body
          session.bodyObserver.observe(parent, { childList: true })
        }

        session.input.addEventListener('input', () => schedule(session, true))
        session.input.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          event.stopPropagation()
          step(session, event.shiftKey ? -1 : 1)
        })
        session.previous.addEventListener('click', () => step(session, -1))
        session.next.addEventListener('click', () => step(session, 1))
        session.close.addEventListener('click', close)
        session.caseButton.addEventListener('click', () => {
          session.caseSensitive = !session.caseSensitive
          session.caseButton.setAttribute('aria-pressed', String(session.caseSensitive))
          session.input.focus({ preventScroll: true })
          schedule(session, true)
        })
        session.wordButton.addEventListener('click', () => {
          session.wholeWord = !session.wholeWord
          session.wordButton.setAttribute('aria-pressed', String(session.wholeWord))
          session.input.focus({ preventScroll: true })
          schedule(session, true)
        })
        session.regexButton.addEventListener('click', () => {
          session.useRegex = !session.useRegex
          session.regexButton.setAttribute('aria-pressed', String(session.useRegex))
          session.input.focus({ preventScroll: true })
          schedule(session, true)
        })
        session.partial.addEventListener('click', () => {
          const older = olderButtonOf(session.scroller)
          if (older === null || older.disabled === true) return
          older.click()
          session.partial.disabled = true
          setTimeout(() => {
            if (find !== session) return
            updatePartial(session)
            schedule(session, false)
          }, 500)
        })

        const selected = selectedTextIn(scroller)
        if (selected !== '') session.input.value = selected
        updatePartial(session)
        updateState(session)
        session.reposition()
        if (find !== session) return false
        session.input.focus({ preventScroll: true })
        session.input.select()
        if (session.input.value !== '') schedule(session, true)
        return true
      }

      const onKeyDown = event => {
        const target = event.target instanceof Node ? event.target : null
        const mod = event.metaKey || event.ctrlKey
        if (mod && !event.altKey && !event.shiftKey && typeof event.key === 'string' && event.key.toLowerCase() === 'f') {
          if (find !== null && target !== null && find.bar.contains(target)) {
            event.preventDefault()
            event.stopPropagation()
            find.input.focus({ preventScroll: true })
            find.input.select()
            return
          }
          const content = resolveContent(target)
          if (content === null) return
          if (isFindOpenFor(content)) {
            event.preventDefault()
            event.stopPropagation()
            find.input.focus({ preventScroll: true })
            find.input.select()
            return
          }
          if (open(content)) {
            event.preventDefault()
            event.stopPropagation()
          }
          return
        }
        if (find === null || target === null) return
        const inBar = find.bar.contains(target)
        const inChat = find.content.contains(target) &&
          (target instanceof Element ? target.closest('[data-composer-seat]') === null : false) &&
          !isEditableElement(target instanceof Element ? target : null)
        if (event.key === 'F3' && (inBar || inChat)) {
          event.preventDefault()
          event.stopPropagation()
          step(find, event.shiftKey ? -1 : 1)
          return
        }
        if (event.key === 'Escape' && inBar) {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }

      const onPointerDown = event => {
        if (find !== null && find.bar.contains(event.target)) return
        const target = event.target instanceof Element ? event.target : null
        lastContent = target === null ? null : contentFor(target)
      }

      document.querySelectorAll('[data-conversation-find]').forEach(element => element.remove())
      document.querySelectorAll('style[data-conversation-find-style]').forEach(element => element.remove())
      const style = document.createElement('style')
      style.setAttribute('data-conversation-find-style', '')
      style.textContent = [
        '[data-conversation-find]{position:fixed;z-index:990;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:6px;border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);border:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16));box-shadow:0 8px 28px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary,#111);font:inherit;font-size:12px;user-select:none}',
        '[data-conversation-find] .dcf-top{display:flex;align-items:center;gap:4px}',
        '[data-conversation-find] .dcf-input{flex:1;min-width:0;height:26px;padding:0 7px;border:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16));border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit;font-size:12px;outline:none}',
        '[data-conversation-find] .dcf-input:focus{border-color:var(--dsw-alias-brand-primary,#4c6ef5);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#4c6ef5)}',
        '[data-conversation-find].is-invalid .dcf-input{border-color:#e5484d;box-shadow:inset 0 0 0 1px #e5484d}',
        '[data-conversation-find] .dcf-count{flex:none;min-width:38px;text-align:center;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}',
        '[data-conversation-find] .dcf-tool{flex:none;width:24px;height:24px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:14px;line-height:22px;cursor:pointer}',
        '[data-conversation-find] .dcf-tool:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111)}',
        '[data-conversation-find] .dcf-tool:disabled{opacity:.5;cursor:default}',
        '[data-conversation-find] .dcf-bottom{display:flex;align-items:center;gap:4px;padding:0 1px}',
        '[data-conversation-find] .dcf-toggle{height:22px;min-width:26px;padding:0 5px;border:0.5px solid transparent;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:11px;line-height:20px;cursor:pointer}',
        '[data-conversation-find] .dcf-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}',
        '[data-conversation-find] .dcf-toggle[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.1));border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.16));color:var(--dsw-alias-label-primary,#111)}',
        '[data-conversation-find] .dcf-partial{flex:none;margin-left:auto;height:22px;padding:0 6px;border:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16));border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);font:inherit;font-size:10.5px;cursor:pointer}',
        '[data-conversation-find] .dcf-partial:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#666)}',
        '[data-conversation-find] .dcf-partial:disabled{opacity:.55;cursor:default}',
        '[data-conversation-find] .dcf-tool:focus-visible,[data-conversation-find] .dcf-toggle:focus-visible,[data-conversation-find] .dcf-partial:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c6ef5);outline-offset:-2px}',
        '::highlight(dsh-conversation-find){background-color:rgba(255,196,0,.38);color:inherit}',
        '::highlight(dsh-conversation-find-current){background-color:rgba(255,146,0,.72);color:inherit}',
      ].join('')
      document.head.appendChild(style)
      window.addEventListener('keydown', onKeyDown, true)
      document.addEventListener('pointerdown', onPointerDown, true)

      return () => {
        window.removeEventListener('keydown', onKeyDown, true)
        document.removeEventListener('pointerdown', onPointerDown, true)
        close()
        style.remove()
      }
    }

    return {
      inject: ['locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'conversation-find: copy')
        const t = ctx.locale.bind(NS)
        ctx.effect(() => {
          if (typeof document === 'undefined') return undefined
          return install(t)
        }, 'conversation-find: transcript find')
      },
      // Test-only handles; the loader ignores extra exports.
      __test: {
        compileMatcher,
        escapeRegExp,
        olderButtonOf,
        textPiecesOf,
      },
    }
  },
})
