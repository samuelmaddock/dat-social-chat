const fs = require('fs')
const path = require('path')
const Dat = require('dat-node')

class App {
    async init() {
        const $ = document.querySelector.bind(document)

        this.$ = {
            profileFieldset: $('.profile-fieldset'),
            profileForm: $('.profile-form'),
            profileCreateBtn: $('.profile-create-btn'),
            profileSaveBtn: $('.profile-save-btn'),

            friendsFieldset: $('.friends-fieldset'),
            friendsList: $('.friends-list'),
            friendsAddBtn: $('.friends-add-btn'),
        }
        
        this.$.profileCreateBtn.addEventListener('click', this.onSaveProfile.bind(this), false);
        this.$.profileSaveBtn.addEventListener('click', this.onSaveProfile.bind(this), false);

        await this.initDat()
        console.info('Initialized app')
    }

    async initDat() {
        try {
            this.archive = await DatSocialArchive.get('./dat')
        } catch (e) {
            console.log(e)
        }

        this.updateUI()
    }
    
    updateUI() {
        const { archive } = this;
        
        // Profile
        this.$.profileForm.id.value = archive ? archive.id : '';
        // this.$.profileForm.name.value = archive ? archive.id : '';
        this.$.profileCreateBtn.disabled = !!archive
        this.$.profileSaveBtn.disabled = !archive

        this.$.profileFieldset.disabled = false
        
        // Friends
        this.$.friendsFieldset.disabled = false
    }

    async onSaveProfile() {
        const form = this.$.profileForm
        const profile = {
            name: form.name.value
        }

        this.archive.updateProfile(profile)
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
    
    updateProfile(profile) {
        const profileJson = JSON.stringify(profile, null, '  ')
        fs.writeFileSync(this.profilePath, profileJson)
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