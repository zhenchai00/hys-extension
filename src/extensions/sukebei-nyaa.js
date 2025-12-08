// sukebei-nyaa.js - modified to use proxy fetch calls (relative /proxy)
// Similar pattern as nyaasi.js but default category for sukebei

const QUALITIES = ['2160', '1080', '720', '540', '480']

function fetchViaProxy(targetUrl, options) {
  const proxied = `/proxy?url=${encodeURIComponent(targetUrl)}`
  return fetch(proxied, options)
}

export default new class SukebeiNyaa {
  constructor() {
    this.url = 'https://sukebei.nyaa.si'
  }

  async test() {
    try {
      const res = await fetchViaProxy(this.url)
      return res.ok
    } catch {
      return false
    }
  }

  parseSize(sizeStr) {
    const match = sizeStr.match(/^([\d.]+)\s*([KMGT]?i?B)$/i)
    if (!match) return 0
    const size = parseFloat(match[1])
    const unit = match[2].toUpperCase()
    const multipliers = {
      'B': 1,
      'KB': 1000,
      'KIB': 1024,
      'MB': 1000000,
      'MIB': 1048576,
      'GB': 1000000000,
      'GIB': 1073741824,
      'TB': 1000000000000,
      'TIB': 1099511627776
    }
    return Math.floor(size * (multipliers[unit] || 1))
  }

  parseResults(html) {
    const results = []
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const rows = doc.querySelectorAll('tbody tr')
    for (const row of rows) {
      const cells = row.querySelectorAll('td')
      if (cells.length < 7) continue
      try {
        const titleLink = cells[1].querySelector('a')
        if (!titleLink) continue
        const title = titleLink.textContent.trim()
        const downloadLinks = cells[2].querySelectorAll('a')
        const lastLink = downloadLinks[downloadLinks.length - 1]
        if (!lastLink) continue
        let downloadUrl = lastLink.getAttribute('href')
        if (!downloadUrl.startsWith('http') && !downloadUrl.startsWith('magnet:')) {
          downloadUrl = this.url + downloadUrl
        }
        const sizeText = cells[3].textContent.trim()
        const size = this.parseSize(sizeText)
        const seeders = parseInt(cells[5].textContent.trim()) || 0
        const leechers = parseInt(cells[6].textContent.trim()) || 0
        const dateText = cells[4].textContent.trim()
        let date = new Date()
        if (dateText && dateText !== '-') {
          const parsed = new Date(dateText)
          if (!isNaN(parsed.getTime())) date = parsed
        }
        let hash = ''
        if (downloadUrl.startsWith('magnet:')) {
          const m = downloadUrl.match(/btih:([a-fA-F0-9]{40})/i)
          if (m) hash = m[1].toLowerCase()
        }
        results.push({
          title,
          link: downloadUrl,
          seeders,
          leechers,
          downloads: 0,
          hash,
          size,
          accuracy: 'medium',
          date
        })
      } catch (err) {
        console.warn('sukebei parse row error', err)
        continue
      }
    }
    return results
  }

  buildSearchQuery(titles, resolution, exclusions) {
    let q = titles[0] || ''
    if (resolution && QUALITIES.includes(resolution)) q += ` ${resolution}p`
    if (exclusions?.length) {
      for (const ex of exclusions) q += ` -${ex}`
    }
    return encodeURIComponent(q)
  }

  async performSearch(query, category = '0_0') {
    const url = `${this.url}/?f=0&c=${category}&q=${query}`
    try {
      const r = await fetchViaProxy(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const html = await r.text()
      return this.parseResults(html)
    } catch (err) {
      console.error('performSearch failed', err)
      return []
    }
  }

  async single({ titles, episode, resolution, exclusions }) {
    if (!titles?.length) throw new Error('No titles')
    let searchT = [...titles]
    if (episode) searchT = titles.map(t => `${t} ${episode.toString().padStart(2,'0')}`)
    const q = this.buildSearchQuery(searchT, resolution, exclusions)
    const results = await this.performSearch(q)
    if (episode) {
      return results.filter(result => {
        const title = result.title.toLowerCase()
        const epPattern = new RegExp(`\\b0?${episode}\\b`)
        return epPattern.test(title) && !title.includes('batch')
      })
    }
    return results.slice(0, 20)
  }

  async batch({ titles, episodeCount, resolution, exclusions }) {
    if (!titles?.length) throw new Error('No titles')
    const batchTitles = titles.map(t => `${t} batch`)
    const q = this.buildSearchQuery(batchTitles, resolution, exclusions)
    const results = await this.performSearch(q)
    const batchResults = results.filter(r => {
      const title = r.title.toLowerCase()
      return title.includes('batch') || title.includes('complete') || (episodeCount && title.includes(`1-${episodeCount}`))
    })
    return batchResults.slice(0, 10).map(r => ({ ...r, type: 'batch' }))
  }

  async movie({ titles, resolution, exclusions }) {
    if (!titles?.length) throw new Error('No titles')
    const q = this.buildSearchQuery(titles, resolution, exclusions)
    const results = await this.performSearch(q)
    return results.filter(r => {
      const title = r.title.toLowerCase()
      return !title.match(/\b(s\d+|season|episode|ep\d+|\d+x\d+)\b/i) && !title.includes('batch')
    }).slice(0, 15)
  }
}()