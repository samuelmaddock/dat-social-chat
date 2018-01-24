const sodium = require('sodium-universal')
const discoverySwarm = require('discovery-swarm')
const swarmDefaults = require('dat-swarm-defaults')

const { EncryptedSocket, signalPeer } = require('./network')

const FRIENDSWARM = new Buffer('swarm2')

// +1 from Dat protocol default to reduce conflict
const DEFAULT_PORT = 3283

const SWARM_OPTS = {
    hash: false
}

// Get discovery key from original key
function getDiscoveryKey(tree) {
    var digest = new Buffer(32)
    sodium.crypto_generichash(digest, FRIENDSWARM, tree)
    console.debug(`FRIENDDISC digest=${digest.toString('hex')}, tree=${tree.toString('hex')}`)
    return digest
}

function createSwarm(opts) {
    const swarm = discoverySwarm(swarmDefaults(SWARM_OPTS))
    swarm.listen(DEFAULT_PORT)
    swarm.join(opts.id, { announce: opts.announce ? opts.announce : true })

    swarm.on('error', function(){
        console.log('Local swarm error', arguments)
        swarm.listen(0)
    })

    return swarm
}

function authConnection(socket, initiator, cb) {

}

function listen(opts, connectionHandler) {
    const discoveryKey = getDiscoveryKey(opts.publicKey)
    const swarm = createSwarm({id: discoveryKey})

    // Wait for connections to perform auth handshake with
    swarm.on('connection', socket => {
        console.log('Local swarm connection', socket)
        const esocket = new EncryptedSocket(socket, opts.publicKey, opts.secretKey)

        esocket.once('connection', () => {
            console.log(`AUTHED WITH PEER! ${socket.address().address}`)
            signalPeer(esocket).then(peer => {
                console.log('PEER PEER', peer)
                esocket.destroy()
                connectionHandler(peer, esocket.peerKey)
            });
        })

        esocket.connect()
    })
    
    return swarm
}

function connect(opts, cb) {
    const hostPublicKey = opts.hostPublicKey
    const discoveryKey = getDiscoveryKey(hostPublicKey)
    const swarm = createSwarm({id: discoveryKey})

    // Wait for connections and attempt to auth with host
    swarm.on('connection', socket => {
        console.log('Remote swarm connection', socket)
        const esocket = new EncryptedSocket(socket, opts.publicKey, opts.secretKey)

        esocket.once('connection', () => {
            console.log(`AUTHED WITH HOST! ${socket.address().address}`)
            signalPeer(esocket, {initiator: true}).then(peer => {
                console.info('HOST PEER', peer)
                esocket.destroy()
                swarm.close()
                cb(null, peer, hostPublicKey)
            })
        })

        esocket.once('error', (err) => {
            esocket.destroy()
            esocket = null  
        })

        esocket.connect(hostPublicKey)
    })
    
    // TODO: timeout
    
    return swarm
}

module.exports = {
    listen,
    connect
}