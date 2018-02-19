const SimplePeer = require('simple-peer')

function writeJSON(stream, object) {
    const buf = new Buffer(JSON.stringify(object))
    stream.write(buf)
}

function readJSON(data, cb) {
    let string = data.toString()
    try {
        const json = JSON.parse(string)
        cb(json);
    } catch (e) {
        throw e;
    }
}

function signalPeer(socket, opts) {
    return new Promise((resolve, reject) => {
        const peer = SimplePeer(opts)
        peer.once('error', reject)

        const writeSignal = answer => writeJSON(socket, answer)
        const readSignal = data => readJSON(data, offer => peer.signal(offer))

        peer.on('signal', writeSignal)
        socket.on('data', readSignal)

        peer.once('connect', () => {
            peer.removeListener('signal', writeSignal)
            socket.removeListener('data', readSignal)
            resolve(peer)
        })
    })
}

module.exports = {
    signalPeer
}
