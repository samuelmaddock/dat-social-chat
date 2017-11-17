const sodium = require('sodium-universal')
const enc = require('sodium-encryption')
const SimplePeer = require('simple-peer')

const SUCCESS = new Buffer(0x1)

function pub2auth(publicKey) {
    const publicAuthKey = new Buffer(sodium.crypto_box_PUBLICKEYBYTES);
    sodium.crypto_sign_ed25519_pk_to_curve25519(publicAuthKey, publicKey);
    return publicAuthKey
}

function secret2auth(secretKey) {
    const secretAuthKey = new Buffer(sodium.crypto_box_SECRETKEYBYTES);
    sodium.crypto_sign_ed25519_sk_to_curve25519(secretAuthKey, secretKey);
    return secretAuthKey
}

function seal(msg, publicKey) {
    var cipher = new Buffer(msg.length + sodium.crypto_box_SEALBYTES)
    sodium.crypto_box_seal(cipher, msg, publicKey)
    return cipher
}

function unseal(cipher, publicKey, secretKey) {
    if (cipher.length < sodium.crypto_box_SEALBYTES) return null
    var msg = new Buffer(cipher.length - sodium.crypto_box_SEALBYTES)
    if (!sodium.crypto_box_seal_open(msg, cipher, publicKey, secretKey)) return null
    return msg
}

async function authHost(socket, publicKey, secretKey, hostKey) {
    const publicAuthKey = pub2auth(publicKey)
    const secretAuthKey = secret2auth(secretKey)
    const hostAuthKey = pub2auth(hostKey)
    const sharedKey = enc.scalarMultiplication(secretAuthKey, hostAuthKey);

    let success, fail
    
    // send encrypted public key to host
    function sendAuthRequest() {
        const box = seal(publicKey, hostAuthKey)
        socket.write(box)
    }

    function receiveChallenge(data) {
        const nonce = data.slice(0, sodium.crypto_box_NONCEBYTES)
        const box = data.slice(sodium.crypto_box_NONCEBYTES, data.length)

        const challenge = enc.decrypt(box, nonce, sharedKey)

        const respNonce = enc.nonce()
        const respBox = enc.encrypt(challenge, respNonce, sharedKey)
    
        const msg = new Buffer(respNonce.length + respBox.length)
        respNonce.copy(msg)
        respBox.copy(msg, nonce.length)
        
        socket.write(msg)
        socket.once('data', receiveAuthSuccess)
    }

    function receiveAuthSuccess(data) {
        if (data.equals(SUCCESS)) {
            success()
        }
    }

    return new Promise((resolve, reject) => {
        success = resolve
        fail = reject

        socket.once('data', receiveChallenge)
        sendAuthRequest()
    })
}

async function authPeer(socket, publicKey, secretKey) {
    const publicAuthKey = pub2auth(publicKey)
    const secretAuthKey = secret2auth(secretKey)

    let success, fail
    
    let sharedKey
    let challenge
    
    function receiveAuthRequest(data) {
        const buf = Buffer.from(data)
        const peerPublicKey = unseal(buf, publicAuthKey, secretAuthKey)
        
        if (!peerPublicKey) {
            console.error('Failed to unseal peer box')
            return
        }
        
        if (publicKey.equals(peerPublicKey)) {
            // console.error('Auth request key is the same as the host')
            // return
        }

        const peerAuthKey = pub2auth(peerPublicKey)
        sharedKey = enc.scalarMultiplication(secretAuthKey, peerAuthKey);
        
        sendChallenge(peerPublicKey)
    }

    function sendChallenge(peerKey) {
        challenge = enc.nonce()
            
        const nonce = enc.nonce()
        const box = enc.encrypt(challenge, nonce, sharedKey)
    
        const msg = new Buffer(nonce.length + box.length)
        nonce.copy(msg)
        box.copy(msg, nonce.length)
        
        socket.write(msg)
        socket.once('data', receiveChallengeVerification)
    }

    function receiveChallengeVerification(data) {
        const nonce = data.slice(0, sodium.crypto_box_NONCEBYTES)
        const box = data.slice(sodium.crypto_box_NONCEBYTES, data.length)

        const decryptedChallenge = enc.decrypt(box, nonce, sharedKey)

        if (challenge.equals(decryptedChallenge)) {
            socket.write(SUCCESS)
            success()
        } else {
            fail()
        }
    }

    return new Promise((resolve, reject) => {
        success = resolve
        fail = reject

        socket.once('data', receiveAuthRequest)
    })
}

const CHUNK_DELIMITER = ';'

function writeJSONChunk(stream, object) {
    const buf = new Buffer(JSON.stringify(object) + CHUNK_DELIMITER)
    stream.write(buf)
}

function readJSONChunk(data, cb) {
    let chunk = data.toString();
    let d_index = chunk.indexOf(CHUNK_DELIMITER);
   
    while (d_index > -1) {         
        try {
            string = chunk.substring(0,d_index);
            json = JSON.parse(string);
            cb(json);
        } catch (e) {
            throw e;
        }
        chunk = chunk.substring(d_index+1);
        d_index = chunk.indexOf(';');
    }  
}

async function signalHost(socket) {
    console.log('SIGNALHOST')
    return new Promise((resolve, reject) => {
        const peer = SimplePeer({initiator: true})
        peer.once('error', reject)

        peer.on('signal', offer => {
            console.log('P1 signal')
            writeJSONChunk(socket, offer)
        })

        peer.once('connect', () => {
            console.log('P1 connect')
            resolve(peer)
        })

        socket.on('data', data => {
            console.log('P1 answer')
            readJSONChunk(data, answer => peer.signal(answer))
        })
    })
}

async function signalPeer(socket) {
    console.log('SIGNALPEER')
    return new Promise((resolve, reject) => {
        const peer = SimplePeer()
        peer.once('error', reject)
        
        peer.on('signal', answer => {
            console.log('P2 signal')
            writeJSONChunk(socket, answer)
        })

        peer.once('connect', () => {
            console.log('P2 connect')
            resolve(peer)
        })
        
        socket.on('data', data => {
            console.log('P2 offer')
            readJSONChunk(data, offer => peer.signal(offer))
        })
    })
}

module.exports = {
    authHost,
    authPeer,
    signalHost,
    signalPeer
}
