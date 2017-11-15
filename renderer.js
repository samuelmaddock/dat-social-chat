const fs = require('fs')
const path = require('path')

const Dat = require('dat-node')
const swarmDefaults = require('dat-swarm-defaults')
const disc = require('discovery-swarm')
const sodium = require('sodium-universal')

const FRIENDSWARM = new Buffer('friendswarm')
// const DEFAULT_PORT = 3282 + 1

function friendDiscoveryKey(tree) {
    var digest = new Buffer(32)
    sodium.crypto_generichash(digest, FRIENDSWARM, tree)
    console.debug(`FRIENDDISC digest=${digest.toString('hex')}, tree=${tree.toString('hex')}`)
    return digest
}

class App {
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
        }
        
        this.$.profileCreateBtn.addEventListener('click', this.onSaveProfile.bind(this), false)
        this.$.profileSaveBtn.addEventListener('click', this.onSaveProfile.bind(this), false)

        this.$.friendsAddBtn.addEventListener('click', this.onAddFriend.bind(this), false)

        await this.initDat()
        this.updateUI()
        console.info('Initialized app')
    }

    async initDat() {
        try {
            this.archive = await DatSocialArchive.get('./dat')
        } catch (e) {
            console.log(e)
            return
        }

        this.profile = await this.archive.getProfile()
        this.friends = await this.archive.getFriends()

        this.archive.dat.network.on('connection', function() {
            console.info('archive connection', arguments);
        });
        
        this.archive.dat.network.on('peer', peer => {
            console.info('archive peer', peer);
        });

        this.initLocalSwarm()
    }

    initLocalSwarm() {
        if (this.localSwarm) {
            this.localSwarm.close()
            this.localSwarm = null
        }
        
        const id = friendDiscoveryKey(this.archive.dat.key)
        console.info(`Starting local swarm ${id.toString('hex')}`);
        
        const swarmOpts = {
            hash: false
        }
        const swarm = disc(swarmDefaults(swarmOpts))
        // swarm.listen(DEFAULT_PORT)
        swarm.join(id, {announce: true})

        swarm.once('error', function(){
            console.log('Local swarm error', arguments)
            // swarm.listen(0)
        })
        
        swarm.on('connection', function(socket) {
            console.log('Local swarm connection', socket)

            socket.on('data', data => {
                console.log('local data', data)
                socket.write('world')
            })
        })

        this.localSwarm = swarm
    }
    
    updateUI() {
        const { archive, profile } = this;
        
        // Profile
        this.$.profileForm.id.value = archive ? archive.id : ''
        this.$.profileForm.name.value = profile ? profile.name : this.$.profileForm.name.value || 'Foobar'
        this.$.profileCreateBtn.disabled = !!archive
        this.$.profileSaveBtn.disabled = !archive

        this.$.profileFieldset.disabled = false
        
        // Friends
        this.$.friendsFieldset.disabled = false
        
        if (this.friends.size > 0) {
            this.$.friendsList.innerHTML = ''
            this.friends.forEach(friendId => {
                const el = document.createElement('li')
                el.innerText = friendId
                el.onclick = this.onConnectToFriend.bind(this, friendId)
                this.$.friendsList.appendChild(el)
            });
        } else {
            this.$.friendsList.innerHTML = 'No friends yet :('
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
        }
        
        const friendId = this.$.friendsForm.friendid.value
        console.log('Add', friendId)
        
        if (this.friends.has(friendId)) {
            alert('Friend ID already added')
            return
        }

        this.$.friendsFieldset.disabled = true;
        
        this.friends.add(friendId)
        this.archive.setFriends(this.friends)
        
        // cleanup
        this.$.friendsForm.friendid.value = ''
        this.$.friendsFieldset.disabled = false;

        this.updateUI()
    }

    onConnectToFriend(friendId) {
        const key = Buffer.from(friendId, 'hex')
        const id = friendDiscoveryKey(key)
        this.connectRemoteSwarm(id)
    }

    connectRemoteSwarm(id) {
        if (this.remoteSwarm) {
            this.remoteSwarm.close()
            this.remoteSwarm = null
        }
        
        console.info(`Connecting to remote swarm ${id.toString('hex')}...`)
        
        // console.info('Connect', friendId, id)
        const swarmOpts = {
            hash: false
        }
        const swarm = disc(swarmDefaults(swarmOpts))
        // swarm.listen(DEFAULT_PORT + 1)
        swarm.join(id, {announce: true})

        swarm.once('error', function(){
            console.log('Remote swarm error', arguments)
            // swarm.listen(0)
        })
        
        swarm.once('connection', function(socket) {
            console.log('Remote swarm connection', socket)
            socket.on('data', data => {
                console.log('remote data', data)
            })
            socket.write('hello')
        })

        this.remoteSwarm = swarm
    }
}

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
                    resolve(null);
                } else {
                    const json = JSON.parse(buf.toString())
                    resolve(json)
                }
            })
        });
    }

    updateProfile(profile) {
        const profileJson = JSON.stringify(profile, null, '  ')
        fs.writeFileSync(this.profilePath, profileJson)
    }

    getFriends() {
        return new Promise((resolve, reject) => {
            this.dat.archive.readFile('friends.json', (err, buf) => {
                if (err) {
                    resolve(new Set());
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
    
    static get(dirpath) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(dirpath)) {
                fs.mkdir(dirpath)
            }
            
            Dat(dirpath, (err, dat) => {
                if (err) {
                    reject(err)
                    return
                }

                const progress = dat.importFiles({watch: true})
                progress.on('put', function (src, dest) {
                    console.log('Importing ', src.name, ' into archive')
                })
                
                dat.joinNetwork()

                console.info(`My dat link is: dat://${dat.key.toString('hex')}`)

                const archive = new DatSocialArchive(dat);
                resolve(archive)
            })
        })
    }
}

function init() {
    const app = new App()
    window.app = app

    app.init()
}
init()