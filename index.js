async function setupPlugin({ config, global }) {
    const customerioBase64AuthToken = Buffer.from(`${config.customerioSiteId}:${config.customerioToken}`).toString(
        'base64'
    )

    global.customerioAuthHeader = {
        headers: {
            Authorization: `Basic ${customerioBase64AuthToken}`,
        },
    }

    const authResponse = await fetchWithRetry(
        'https://beta-api.customer.io/v1/api/info/ip_addresses',
        global.customerioAuthHeader
    )

    if (!statusOk(authResponse)) {
        throw new Error('Unable to connect to Customer.io')
    }
}

async function processEventBatch(events, { global }) {
    for (let event of events) {
        await exportToCustomerio({ ...event }, global.customerioAuthHeader)
    }
    return events
}

async function exportToCustomerio(event, authHeader) {
    let customerResponse = await fetchWithRetry(
        `https://beta-api.customer.io/v1/api/activities?customer_id=${event.distinct_id}`,
        authHeader
    )

    if (customerResponse.status === 404) {
        const options = isEmail(event.distinct_id)
            ? {
                  headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                      ...authHeader.headers,
                  },
                  body: JSON.stringify({ email: event.distinct_id }),
              }
            : authHeader
        customerResponse = await fetchWithRetry(
            `https://track.customer.io/api/v1/customers/${event.distinct_id}`,
            options,
            'PUT'
        )
    }

    if (!statusOk(customerResponse)) {
        throw new Error('Error when connecting to Customer.io')
    }

    const eventInsertResponse = await fetchWithRetry(
        `https://track.customer.io/api/v1/customers/${event.distinct_id}/events`,
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...authHeader.headers,
            },
            body: JSON.stringify({ name: event.event, data: event.properties }),
        },
        'POST'
    )

    if (!statusOk(eventInsertResponse)) {
        console.log(`Unable to send event ${event.event} to Customer.io`)
    }
}

async function fetchWithRetry(url, options = {}, method = 'GET', isRetry = false) {
    try {
        const res = await fetch(url, { method: method, ...options })
        return res
    } catch {
        if (isRetry) {
            throw new Error(`${method} request to ${url} failed.`)
        }
        const res = await fetchWithRetry(url, options, (method = method), (isRetry = true))
        return res
    }
}

function statusOk(res) {
    return String(res.status)[0] === '2'
}

function isEmail(email) {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    return re.test(String(email).toLowerCase())
}
