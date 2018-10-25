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

async function runScraper(bugName, location, numImages) {

  console.log(`scraping for ${numImages} images of ${bugName} in ${location}...`)
  console.time('⏳⏳ total time ⏳⏳');

  const screen = {
    width: 640,
    height: 480
  };

  const url = 'https://www.inaturalist.org/taxa/1-Animalia'
  let driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(new chrome.Options().headless().windowSize(screen))
    .build();

  try {
    await driver.get(url);

    // set location
    let locationNameFound;
    if (location) {
      const locationButton = await driver.findElement(By.className('PlaceChooserPopoverTrigger RecordChooserPopoverTrigger  undefined'));
      await locationButton.click()
      const locationForm = await driver.findElement(By.xpath("//*[@class='form-group']/input"))
      await locationForm.sendKeys(location)
      await driver.sleep(1500)

      const dropdown = await driver.findElement(By.className('list-unstyled'))
      const options = await dropdown.findElements(By.className("media"));
      await options[0].click()

      locationNameFound = await driver.findElement(By.className('PlaceChooserPopoverTrigger RecordChooserPopoverTrigger  undefined')).getText();
      console.log('location chosen: ' + locationNameFound)
    }

    // find bug page
    const search = await driver.findElement(By.className('form-control input-sm ui-autocomplete-input'))
    await search.sendKeys(bugName);
    await driver.sleep(2000)
    const searchResults = await driver.wait(until.elementsLocated(By.className('ac-result taxon ui-menu-item')))
    const topResult = searchResults[0]
    const text = await topResult.getText()
    const bugNameFound = text.split('\n')[0]
    console.log('species chosen: ' + bugNameFound)

    const bugLink = await topResult.findElement(By.tagName('a')).getAttribute('href')
    await driver.get(bugLink);

    const viewMore = await driver.wait(until.elementLocated(By.className('viewmore')))
    const viewMoreLink = await viewMore.findElement(By.tagName('a')).getAttribute('href')
    await driver.get(viewMoreLink)

    // find # of photos requested
    let currentImages = 0;
    var bar = new ProgressBar('loading photos [:bar] :percent :elapsed', { total: numImages, width: 50 });

    let photos;
    while(currentImages < numImages) {
      await driver.executeScript('window.scrollTo(0,100000);');
      await driver.sleep(3000)
      photos = await driver.findElements(By.className('CoverImage low undefined loaded'));

      if (photos.length === currentImages) {
        await driver.executeScript('window.scrollBy(0,-1000);');
        await driver.sleep(1000)
      }

      currentImages = photos.length
      bar.tick(currentImages - bar.curr)
    }

    console.log(`image loading complete - ${numImages} photos`)

    let urls = [];
    for (let i=0; i < numImages; i++) {
      const photo = photos[i];
      const urlObj = await photo.getCssValue('background-image')
      urls.push(urlObj.split(`"`)[1]);
    }

    // download image
    const imgDatas = await getImageData(urls);
    console.log('photos downloaded successfully')

    // send to s3
    await uploadToS3(imgDatas, bugNameFound, locationNameFound);
    console.log('💦💦💦 success 👉👌 💦💦💦');
    console.timeEnd('⏳⏳ total time ⏳⏳')
  }
  catch(err) {
    console.error(err)
  }
  finally {
    await driver.quit();
  }
}

function getImageData(urls) {
  var bar = new ProgressBar('downloading photos [:bar] :percent :elapsed', { total: urls.length, width: 50 });

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

function uploadToS3(imgDatas, bugName, locationName) {
  var bar = new ProgressBar(`uploading ${imgDatas.length} photos to AWS S3... [:bar] :percent :elapsed`, { total: imgDatas.length, width: 50 });

  return Promise.map(imgDatas, (imgData, i, length) => {
    return s3.putObject({
      Bucket: config.aws.s3_bucket_name,
      Key: `${bugName}/${locationName || 'no location'}/${randomstring.generate(5)}.jpg`,
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
prompt.get(['bugName', 'location', 'numImages'], function (err, result) {
  runScraper(result.bugName, result.location, Number(result.numImages))
});
