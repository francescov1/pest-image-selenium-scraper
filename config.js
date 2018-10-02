module.exports = {
  'aws': {
    'version': process.env.AWS_VERSION,
    'region': process.env.AWS_REGION,
    'access_key_id': process.env.AWS_ACCESS_KEY_ID,
    'secret_access_key': process.env.AWS_SECRET_ACCESS_KEY,
    's3_bucket_name': process.env.S3_BUCKET_NAME
  }
}
