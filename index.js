'use strict';
require('dotenv').config();
global.Promise = require('bluebird');
const prompt = require('prompt');
const request = require('request-promise');
const AWS = require('aws-sdk');
const { Builder, By, Key, until, Button } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const config = require('./config');
const ProgressBar = require('progress');

const randomstring = require('randomstring');
AWS.config.update({
  accessKeyId: config.aws.access_key_id,
  secretAccessKey: config.aws.secret_access_key,
  region: config.aws.region
});

const s3 = new AWS.S3({ apiVersion: config.aws.version })

/* websites
- https://www.insectimages.org/browse/taxthumb.cfm?order=39
- https://www.insectimages.org/search/action.cfm?q=flea+beetle
- https://www.inaturalist.org/

- ground beetles (Carabidae): https://www.inaturalist.org/taxa/49567-Carabidae/browse_photos
*/

async function runScraper(url, numImages) {
  if (!url)
    url = 'https://www.inaturalist.org/taxa/49567-Carabidae/browse_photos'

  console.log(`scraping ${url} for images...`)
  const screen = {
    width: 640,
    height: 480
  };

  let driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(new chrome.Options().headless().windowSize(screen))
    .build();

  try {
    await driver.get(url);

    let numPhotos = 0;
    var bar = new ProgressBar('loading photos [:bar] :percent :etas', { total: numImages, width: 50 });

    let photos;
    while(numPhotos < numImages) {
      await driver.executeScript('window.scrollTo(0,100000);');
      await driver.sleep(3000)
      photos = await driver.findElements(By.className('CoverImage low undefined loaded'));

      if (photos.length === numPhotos) {
        await driver.executeScript('window.scrollTo(100000, 0);');
        await driver.sleep(1000)
      }

      numPhotos = photos.length
      bar.tick(numPhotos - bar.curr)
    }

    console.log(`image loading complete - ${photos.length} photos`)

    let urls = [];
    for (let i=0; i < photos.length; i++) {
      const photo = photos[i];
      const urlObj = await photo.getCssValue('background-image')
      urls.push(urlObj.split(`"`)[1]);
    }

    // download image
    const imgDatas = await getImageData(urls);
    console.log('photos downloaded successfully')

    // send to s3
    await uploadToS3(imgDatas);
    console.log('💦💦💦 Success 👉👌 💦💦💦');
  }
  catch(err) {
    console.error(err)
  }
  finally {
    await driver.quit();
  }
}

function getImageData(urls) {
  var bar = new ProgressBar('downloading photos [:bar] :percent :etas', { total: urls.length, width: 50 });

  return Promise.map(urls, url => {
    return request({
      url: url,
      method: 'get',
      encoding: null
    })
    .then(results => {
      bar.tick()
      return results;
    })
    .catch(err => console.error(err));
  });
}

function uploadToS3(imgDatas) {
  var bar = new ProgressBar(`uploading ${imgDatas.length} photos to AWS S3... [:bar] :percent :etas`, { total: imgDatas.length, width: 50 });

  return Promise.map(imgDatas, (imgData, i, length) => {
    return s3.putObject({
      Bucket: config.aws.s3_bucket_name,
      Key: `carabidae/${randomstring.generate(5)}.jpg`,
      Body: imgData
    }).promise()
    .then(result => {
      bar.tick()
      return result;
    })
    .catch(err => console.error(err));
  });

}

prompt.start();
prompt.get(['url', 'numImages'], function (err, result) {
  runScraper(result.url, Number(result.numImages))
});
