const { createConnection, isIP } = require('net')
const servers = require('./servers')

const QUERY_ADDR_TPL_VAR = '%{addr}'
const FALLBACK_WHOIS_SERVER = 'whois.ripe.net'
const DEFAULT_OPTIONS = {
  timeout: null,
  follow: 2,
  host: null,
  port: 43,
  query: `${QUERY_ADDR_TPL_VAR}\r\n`
}

// possible refferer whois server fields
const FIELDS_REFERRAL = [
  'ReferralServer',
  'Registrar Whois',
  'Whois Server',
  'WHOIS Server',
  'Registrar WHOIS Server'
]

// RegExp borrowed from npm whois module
const whoisReferralRegExp = RegExp([
  `(?:${FIELDS_REFERRAL.join('|')})`,
  ':[^\\S\n]*',
  '(?:r?whois://)?',
  '([^\\s]*)'
].join(''))

module.exports = easyWhois

function easyWhois (addr, passedOptions = {}) {
  const options = Object.assign(
    {},
    DEFAULT_OPTIONS,
    passedOptions
  )

  if (!options.server) {
    Object.assign(
      options,
      getWhoisServerOptionsForAddr(addr)
    )
  }

  Object.assign(
    options,
    normalizeServerString(options.server)
  )

  if (!options.server) {
    throw new Error(`No whois server found for '${addr}'`)
  }

  const client = createConnection({
    host: options.server,
    port: options.port
  }, () => {
    if (options.timeout) {
      client.setTimeout(options.timeout)
    }

    const query = options.query.replace(QUERY_ADDR_TPL_VAR, addr)
    client.write(query)
  })

  let response = ''
  client.on('data', (data) => {
    response += data
  })

  return new Promise((resolve, reject) => {
    client.on('error', reject)
    client.on('timeout', () => {
      reject(new Error('Connection timed out'))
    })

    client.on('close', async (hadError) => {
      if (hadError) return

      if (!options.follow) {
        resolve(response)
        return
      }

      const referralServer = getReferralFromResponse(response)
      if (!referralServer || referralServer === options.server) {
        resolve(response)
        return
      }

      resolve(await easyWhois(addr, Object.assign(
        {},
        DEFAULT_OPTIONS,
        {
          // inherit user given timeout
          timeout: options.timeout,
          follow: options.follow - 1,
          server: referralServer
        }
      )))
    })
  })
}

function getWhoisServerOptionsForAddr (addr) {
  if (isIP(addr)) {
    return servers['_']
  }

  let lookupDomain = addr
  let serverOptions
  while (true) {
    serverOptions = servers[lookupDomain]
    if (serverOptions) break
    lookupDomain = lookupDomain.replace(/^.+?(\.|$)/, '')
    if (lookupDomain === '') return FALLBACK_WHOIS_SERVER
  }

  return normalizeServerOptions(serverOptions)
}

function normalizeServerString (serverString) {
  const parts = serverString.split(':', 2)
  const serverOptions = {
    host: parts[0]
  }
  if (parts.length > 1) {
    serverOptions.port = parts[1]
  }
  return serverOptions
}

function normalizeServerOptions (serverOptions) {
  if (typeof serverOptions === 'string') {
    return normalizeServerString(serverOptions)
  }

  return serverOptions
}

function getReferralFromResponse (response) {
  const match = response
    .replace(/\r/gm, '')
    .match(whoisReferralRegExp)

  if (!match) return
  return match[1]
}
