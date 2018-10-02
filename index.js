'use strict';
require('dotenv').config();
global.Promise = require('bluebird');

const request = require('request-promise');
const AWS = require('aws-sdk');
const { Builder, By, Key, until, Button } = require('selenium-webdriver');
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

async function runScraper() {
  let driver = await new Builder().forBrowser('chrome').build();
  try {
    await driver.get('https://www.inaturalist.org/taxa/49567-Carabidae/browse_photos');
    await driver.sleep(3000)

    let numPhotos = 0;
    var bar = new ProgressBar('loading photos [:bar] :percent :etas', { total: 100, width: 50 });

    while(numPhotos < 100) {
      await driver.executeScript('window.scrollTo(0,10000);');
      await driver.sleep(3000)
      const photos = await driver.wait(until.elementsLocated(By.className('CoverImage low undefined loaded')), 5 * 1000);

      if (photos.length === numPhotos) {
        await driver.executeScript('window.scrollTo(10000, 0);');
        await driver.sleep(1000)
      }

      numPhotos = photos.length
      bar.tick(numPhotos - bar.curr)
    }

    console.log('image loading complete')
    const photos = await driver.wait(until.elementsLocated(By.className('CoverImage low undefined loaded')), 5 * 1000)

    let urls = [];
    for (let i=0; i < photos.length; i++) {
      const photo = photos[i];
      const urlObj = await photo.getCssValue('background-image')
      urls.push(urlObj.split(`"`)[1]);
    }

    // download image
    const imgDatas = await getImageData(urls);
    console.log('photos downloaded successfully')
    console.log(`uploading ${imgDatas.length} photos to AWS S3...`);

    // send to s3
    await uploadToS3(imgDatas);
    console.log('success!');
  }
  catch(err) {
    console.error(err)
  }
  finally {
  //  await driver.quit();
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
  var bar = new ProgressBar('uploading photos to AWS S3 [:bar] :percent :etas', { total: urls.length, width: 50 });

  return Promise.map(imgDatas, (imgData, i, length) => {
    return s3.putObject({
      Bucket: config.aws.s3_bucket_name,
      Key: `infield/carabidae/${randomstring.generate(5)}.jpg`,
      Body: imgData
    }).promise()
    .then(result => {
      bar.tick()
      return results;
    })
    .catch(err => console.error(err));
  });

}

runScraper();
