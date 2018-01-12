const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')

const Dat = require('dat-node')
const swarmDefaults = require('dat-swarm-defaults')
const discoverySwarm = require('discovery-swarm')
const sodium = require('sodium-universal')
const ram = require('random-access-memory')

const { EncryptedSocket, signalPeer } = require('./network');

const FRIENDSWARM = new Buffer('swarm2')
const DEFAULT_PORT = 3283

const SWARM_OPTS = {
    hash: false
}

const DEFAULT_NAME = 'Foobar'

function key2str(key) {
    return typeof key === 'string' ? key : key.toString('hex')
}

function friendDiscoveryKey(tree) {
    var digest = new Buffer(32)
    sodium.crypto_generichash(digest, FRIENDSWARM, tree)
    console.debug(`FRIENDDISC digest=${digest.toString('hex')}, tree=${tree.toString('hex')}`)
    return digest
}

class App {
    get localKey() {
        return this.archive ? this.archive.dat.key : null;
    }
    
    async init() {
        const $ = document.querySelector.bind(document)

        this.$ = {
            profileFieldset: $('.profile-fieldset'),
            profileForm: $('.profile-form'),
            profileCreateBtn: $('.profile-create-btn'),
            profileSaveBtn: $('.profile-save-btn'),

            friendsFieldset: $('.friends-fieldset'),
            friendsForm: $('.friends-form'),
            friendsList: $('.friends-list'),
            friendsAddBtn: $('.friends-add-btn'),

            chatFieldset: $('.chat-fieldset'),
            chatTitle: $('.chat-title'),
            chatForm: $('.chat-form'),
            chatMessages: $('.chat-messages'),
            chatInput: $('.chat-form input[name=message]'),
            chatSendBtn: $('.chat-send-btn'),
            chatDisconnectBtn: $('.chat-disconnect-btn'),
        }
        
        this.$.profileCreateBtn.addEventListener('click', this.onSaveProfile.bind(this), false)
        this.$.profileSaveBtn.addEventListener('click', this.onSaveProfile.bind(this), false)

        this.$.friendsAddBtn.addEventListener('click', this.onAddFriend.bind(this), false)

        this.$.chatInput.addEventListener('keypress', this.onChatKeyPress.bind(this), false)
        this.$.chatSendBtn.addEventListener('click', this.onSendChat.bind(this), false)
        this.$.chatDisconnectBtn.addEventListener('click', this.onDisconnectChat.bind(this), false)

        this.updateUI = this.updateUI.bind(this)
        
        await this.initDat()
        this.updateUI()
        friendLoader.on('update', this.updateUI)
        console.info('Initialized app')
    }

    async initDat() {
        try {
            this.archive = await DatSocialArchive.getLocal()
        } catch (e) {
            console.log(e)
            return
        }

        this.profile = await this.archive.getOrCreateProfile()
        this.friends = await this.archive.getFriends()
        
        this.archive.dat.network.on('connection', function() {
            console.info('archive connection', arguments);
        });
        
        this.archive.dat.network.on('peer', peer => {
            console.info('archive peer', peer);
        });
        
        this.initLocalSwarm()

        this.friends.forEach(friendId => friendLoader.loadFriendArchive(friendId));
    }

    initLocalSwarm() {
        if (this.localSwarm) {
            this.localSwarm.close()
            this.localSwarm = null
        }
        
        const id = friendDiscoveryKey(this.archive.dat.key)
        console.info(`Starting local swarm ${id.toString('hex')}`);

        const swarm = discoverySwarm(swarmDefaults(SWARM_OPTS))
        swarm.listen(DEFAULT_PORT)
        swarm.join(id, { announce: true })

        swarm.on('error', function(){
            console.log('Local swarm error', arguments)
            swarm.listen(0)
        })
        
        swarm.on('connection', socket => {
            console.log('Local swarm connection', socket)

            const dat = this.archive.dat
            const publicKey = dat.archive.key
            const secretKey = dat.archive.metadata.secretKey
            
            const esocket = new EncryptedSocket(socket, publicKey, secretKey)

            esocket.once('connection', () => {
                console.log(`AUTHED WITH PEER! ${socket.address().address}`)
                signalPeer(esocket).then(peer => {
                    console.log('PEER PEER', peer)
                    esocket.destroy()
                    this.setupChat(peer, esocket.peerKey)
                });
            })

            esocket.connect()
        })

        this.localSwarm = swarm
    }

    setupChat(peer, peerKey) {
        this.chat = new ChatRoom(peer, peerKey, this.localKey)

        this.chat.on('message', this.updateUI.bind(this))
        this.chat.on('close', () => {
            this.chat = undefined
            this.updateUI()
        })
        
        this.updateUI()
    }
    
    updateUI() {
        const { archive, profile } = this;
        
        // Profile
        this.$.profileForm.id.value = archive ? archive.id : ''
        this.$.profileForm.name.value = profile ? profile.name : this.$.profileForm.name.value || DEFAULT_NAME
        this.$.profileCreateBtn.disabled = !!archive
        this.$.profileSaveBtn.disabled = !archive

        this.$.profileFieldset.disabled = false
        
        // Friends
        this.$.friendsFieldset.disabled = false
        
        if (this.friends.size > 0) {
            this.$.friendsList.innerHTML = ''
            this.friends.forEach(friendId => {
                const el = document.createElement('li')
                el.innerText = friendLoader.resolveName(friendId) + ' '
                
                const connect = document.createElement('a')
                connect.innerText = 'Connect'
                connect.href = 'javascript:void(0)'
                connect.onclick = this.onConnectToFriend.bind(this, friendId)

                el.appendChild(connect)
                
                this.$.friendsList.appendChild(el)
            });
        } else {
            this.$.friendsList.innerHTML = 'No friends yet :('
        }

        // Chat
        this.$.chatFieldset.disabled = !this.chat;

        if (this.chat) {
            this.$.chatTitle.innerText = `Chat: ${friendLoader.resolveName(this.chat.peerId)}`
            
            this.$.chatMessages.innerHTML = ''
            this.chat.messages.forEach(message => {
                const el = document.createElement('li')
                el.innerText = `${friendLoader.resolveName(message.author)}: ${message.text}`
                this.$.chatMessages.appendChild(el)
            });
        } else {
            this.$.chatTitle.innerText = 'Chat'
            this.$.chatMessages.innerHTML = 'Not connected'
        }
    }

    async onSaveProfile() {
        const form = this.$.profileForm
        const profile = {
            name: form.name.value
        }

        this.$.profileFieldset.disabled = true;
        this.archive.updateProfile(profile)
        this.$.profileFieldset.disabled = false;
    }

    async onAddFriend() {
        if (!this.$.friendsForm.checkValidity()) {
            alert('Invalid friend ID')
            return
        }
        
        const friendId = this.$.friendsForm.friendid.value
        console.log('Add friend', friendId)
        
        if (this.friends.has(friendId)) {
            console.warn('Friend ID already added')
            return
        }

        this.$.friendsFieldset.disabled = true;
        
        this.friends.add(friendId)
        this.archive.setFriends(this.friends)
        
        // cleanup
        this.$.friendsForm.friendid.value = ''
        this.$.friendsFieldset.disabled = false;

        this.updateUI()

        friendLoader.loadFriendArchive(friendId)
    }

    onChatKeyPress(e) {
        if (e.key === 'Enter') {
            e.preventDefault()
            this.onSendChat()
        }
    }
    
    onSendChat() {
        if (!this.$.chatForm.checkValidity()) {
            return
        }

        const message = this.$.chatForm.message.value
        this.chat.sendMessage(message)

        this.$.chatForm.message.value = '';
    }

    onDisconnectChat() {
        if (this.chat) {
            this.chat.close()
        }
    }

    onConnectToFriend(friendId) {
        this.connectRemoteSwarm(friendId)
    }

    connectRemoteSwarm(friendId) {
        if (this.remoteSwarm) {
            this.remoteSwarm.close()
            this.remoteSwarm = null
        }

        const friendKey = Buffer.from(friendId, 'hex')
        const id = friendDiscoveryKey(friendKey)
        
        console.info(`Connecting to remote swarm ${id.toString('hex')}...`)
        
        const swarm = discoverySwarm(swarmDefaults(SWARM_OPTS))
        swarm.listen(DEFAULT_PORT+1)
        swarm.join(id)

        swarm.on('error', function(){
            console.log('Remote swarm error', arguments)
            swarm.listen(0)
        })
        
        swarm.on('connection', socket => {
            console.log('Remote swarm connection', socket)

            const dat = this.archive.dat
            const publicKey = dat.archive.key
            const secretKey = dat.archive.metadata.secretKey
            
            const esocket = new EncryptedSocket(socket, publicKey, secretKey)

            esocket.once('connection', () => {
                console.log(`AUTHED WITH HOST! ${socket.address().address}`)
                signalPeer(esocket, {initiator: true}).then(peer => {
                    console.info('HOST PEER', peer)
                    esocket.destroy()
                    swarm.close()
                    this.setupChat(peer, friendKey)
                })
            })

            esocket.connect(friendKey)
        })

        this.remoteSwarm = swarm
    }
}

class ChatRoom extends EventEmitter {
    constructor(peer, peerKey, localKey) {
        super()

        this.peer = peer
        this.peerKey = peerKey
        this.localKey = localKey

        this.peer.on('close', () => {
            this.peer = undefined
            this.close()
        })

        this.peer.on('data', this.receive.bind(this))

        this.messages = [];
    }

    get peerId() {
        return key2str(this.peerKey)
    }

    dispatch(action) {
        switch (action.type) {
            case 'message':
                this.onMessage(action.payload, this.peerId)
                break;
            default:
                console.warning(`Unknown chat message type=${action.type}`, action)
        }
    }

    send(type, payload) {
        const action = JSON.stringify({type, payload})
        const buf = Buffer.from(ChatRoom.header + action, 'utf-8')
        this.peer.send(buf)
    }

    receive(buf) {
        if (buf.slice(0, ChatRoom.header.length).toString('utf-8') !== ChatRoom.header) {
            this.close()
            return
        }

        let action
        
        try {
           action = buf.slice(ChatRoom.header.length, buf.length)
           action = JSON.parse(action)
        } catch (e) {
            console.error('Failed to receive chat action', e)
            this.close()
            return
        }

        this.dispatch(action)
    }
    
    close() {
        if (this.peer) {
            this.peer.destroy()
            this.peer = undefined
        }

        this.emit('close')
    }

    sendMessage(message) {
        this.send('message', message)
        this.onMessage(message, this.localKey)
    }

    onMessage(text, author) {
        const message = { author, text }
        this.messages.push(message)
        this.emit('message', message)
    }
}

ChatRoom.header = 'CHAT'

class DatSocialArchive {
    constructor(dat) {
        this.dat = dat;
    }

    get id() {
        return this.dat.key.toString('hex');
    }

    get profilePath() {
        return path.join(this.dat.path, 'profile.json')
    }
    
    get friendsPath() {
        return path.join(this.dat.path, 'friends.json')
    }
    
    getProfile() {
        return new Promise((resolve, reject) => {
            this.dat.archive.readFile('profile.json', (err, buf) => {
                if (err) {
                    reject()
                } else {
                    const json = JSON.parse(buf.toString('utf-8'))
                    resolve(json)
                }
            })
        });
    }

    async getOrCreateProfile() {
        try {
            return await this.getProfile()
        } catch (e) {
            const profile = { name: DEFAULT_NAME }
            await this.updateProfile(profile)
            return profile
        }
    }

    updateProfile(profile) {
        const profileJson = JSON.stringify(profile, null, '  ')
        fs.writeFileSync(this.profilePath, profileJson)
    }

    getFriends() {
        return new Promise((resolve, reject) => {
            this.dat.archive.readFile('friends.json', (err, buf) => {
                if (err) {
                    resolve(new Set())
                } else {
                    const jsonArray = JSON.parse(buf.toString())
                    const set = new Set(jsonArray)
                    resolve(set)
                }
            })
        });
    }

    setFriends(friendSet) {
        const array = JSON.stringify(Array.from(friendSet))
        fs.writeFileSync(this.friendsPath, array)
    }
    
    static get(dirOrStorage, opts = {}) {
        return new Promise((resolve, reject) => {
            Dat(dirOrStorage, opts, (err, dat) => {
                if (err) {
                    reject(err)
                    return
                }
                
                dat.joinNetwork(err => {
                    reject(err)

                    // After the first round of network checks, the callback is called
                    // If no one is online, you can exit and let the user know.
                    if (!dat.network.connected || !dat.network.connecting) {
                        reject('Failed to load archive')
                    }
                })

                const archive = new DatSocialArchive(dat);
                resolve(archive)
            })
        })
    }

    static async getLocal() {
        const dirpath = './dat';
        
        if (!fs.existsSync(dirpath)) {
            fs.mkdir(dirpath)
        }

        const archive = await DatSocialArchive.get(dirpath)
        const dat = archive.dat

        const progress = dat.importFiles({watch: true})
        progress.on('put', function (src, dest) {
            console.log('Importing ', src.name, ' into archive')
        })
        
        console.info(`My dat link is: dat://${key2str(dat.key)}`)

        return archive
    }
}

class FriendLoader extends EventEmitter {
    constructor() {
        super()
        this.cache = new Map()
    }
    
    resolveName(friendId) {
        const key = key2str(friendId)
        const shortKey = key.substr(0,7)
        return this.cache.has(key) && this.cache.get(key).name || shortKey
    }

    async loadFriendArchive(friendId) {
        const archive = await DatSocialArchive.get(ram, { key: friendId })
        const profile = await archive.getProfile()
        this.cache.set(key2str(friendId), profile)
        this.emit('update')
    }
}

const friendLoader = new FriendLoader()

function init() {
    const app = new App()
    window.app = app

    app.init()
}
init()