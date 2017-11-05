const fs = require('fs')
const path = require('path')
const Dat = require('dat-node')

class DatSocialArchive {
    static get dir() {
        return path.join(process.cwd(), '/dat')
    }

    static get profilePath() {
        return path.join(this.dir, 'profile.json')
    }

    static checkDir() {
        if (!fs.existsSync(this.dir)){
            fs.mkdirSync(this.dir)
        }
    }

    static get() {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(this.dir)) {
                reject('No dat dir')
                return
            }
            
            Dat(this.dir, (err, dat) => {
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
                resolve(dat)
            })
        })
    }
    
    static updateProfile(profile) {
        this.checkDir()

        const profileJson = JSON.stringify(profile, null, '  ')
        fs.writeFileSync(this.profilePath, profileJson)
    }
}

class App {
    async init() {
        const $ = document.querySelector.bind(document)

        this.$ = {
            profileFieldset: $('.profile-fieldset'),
            profileForm: $('.profile-form'),
            profileCreateBtn: $('.profile-create-btn'),
            profileSaveBtn: $('.profile-save-btn'),
        }
        
        this.$.profileCreateBtn.addEventListener('click', this.updateProfile.bind(this), false);
        this.$.profileSaveBtn.addEventListener('click', this.updateProfile.bind(this), false);

        await this.initDat()
        console.info('Initialized app')
    }

    async initDat() {
        try {
            const dat = await DatSocialArchive.get()
            this.dat = dat
        } catch (e) {
            console.log(e)
        }

        this.updateProfileFields()
    }
    
    updateProfileFields() {
        this.$.profileCreateBtn.disabled = !!this.dat
        this.$.profileSaveBtn.disabled = !this.dat

        this.$.profileFieldset.disabled = false
    }

    updateProfile() {
        const form = this.$.profileForm
        const profile = {
            name: form.name.value
        }
        console.log('create', profile)

        DatSocialArchive.updateProfile(profile)

        if (!this.dat) {
            this.initDat()
        }
    }
}

const app = new App()
app.init()
window.app = app
