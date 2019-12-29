const qiniu = require('qiniu')
const path = require('path')
const ora = require('ora')
const chalk = require('chalk')

class QiniuUploadWebpackPlugin {
  constructor (options) {
    if ( !options ||
      !options.publicPath ||
      !options.accessKey ||
      !options.secretKey ||
      !options.bucket ||
      !options.zone
    ) {
      throw new Error(chalk.red('请检查传递参数是否完整！'))
    }

    this._options = Object.assign({
      cover: false
    }, options)
    // 创建七牛认证信息
    this.qiniuAuthenticationConfig = {}
    // 鉴权
    this.qiniuAuthenticationConfig.mac = new qiniu.auth.digest.Mac(
      this._options.accessKey,
      this._options.secretKey
    )
    // 创建上传token
    const putPolicy = new qiniu.rs.PutPolicy({
      scope: this._options.bucket
    })
    this.qiniuAuthenticationConfig.uploadToken = putPolicy.uploadToken(
      this.qiniuAuthenticationConfig.mac
    )
    let config = new qiniu.conf.Config()
    // 存储空间对应的机房
    config.zone = qiniu.zone[this._options.zone]
    this.qiniuAuthenticationConfig.formUploader = new qiniu.form_up.FormUploader(
      config
    )
  }
  apply (compiler) {
    // 修改默认配置
    compiler.hooks.compilation.tap('QiniuUploadWebpackPlugin', compilation => {
      compilation.outputOptions.publicPath = this._options.publicPath
      this.absolutePath = compilation.outputOptions.path
    })

    compiler.hooks.done.tapAsync('QiniuUploadPlugin', (data, callback) => {
      callback()
      let assetsPromise = []
      console.log('Start to upload qiniu cloud...')
      Object.keys(data.compilation.assets).forEach(file => {
        // 上传非html文件
        if (file && !(file.indexOf('.html') >= 0)) {
          assetsPromise.push(file)
        }
      })
      // 构建异步上传
      this.qiniuUploadFile(assetsPromise, 0)
    })
  }
  // 上传对象
  qiniuUploadFile (filenames, index, coverUploadToken) {
    if (index >= filenames.length) {
      console.log(chalk.bgGreen(chalk.black(' DONE ')) + chalk.green(' Qiniu upload successfully!'))
      return
    }
    const filename = filenames[index]
    const key = filename
    const localFile = path.join(this.absolutePath || '', filename)
    const spinner = ora(`uploading ${key}...`).start()
    const uploadToken = coverUploadToken
      ? coverUploadToken
      : this.qiniuAuthenticationConfig.uploadToken
    const putExtra = new qiniu.form_up.PutExtra()
    this.qiniuAuthenticationConfig.formUploader.putFile(
      uploadToken,
      key,
      localFile,
      putExtra,
      (respErr, respBody, respInfo) => {
        if (respErr) {
          throw respErr
        }
        if (respInfo.statusCode === 200) {
          spinner.succeed(`file: ${key} ` + chalk.green('success！'))
          this.qiniuUploadFile(filenames, index + 1)
        } else {
          if (
            this._options.cover &&
            (respInfo.status === 614 || respInfo.statusCode === 614)
          ) {
            spinner.fail(`file：${key}, Already exists, try to overwrite upload!`)
            this.qiniuUploadFile(filenames, index, this.coverUploadFile(filename))
          } else {
            spinner.fail(`file：${key} ` + chalk.red('fail！'))
            this.qiniuUploadFile(filenames, index + 1)
          }
        }
      }
    )
  }

  coverUploadFile (filename) {
    const options = {
      scope: this._options.bucket + ':' + filename
    }
    const putPolicy = new qiniu.rs.PutPolicy(options)
    return putPolicy.uploadToken(this.qiniuAuthenticationConfig.mac)
  }
}

module.exports = QiniuUploadWebpackPlugin