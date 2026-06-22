import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI!

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is not set')
}

declare global {
  // eslint-disable-next-line no-var
  var _mongooseConn: Promise<typeof mongoose> | undefined
}

function createConnection() {
  const promise = mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    socketTimeoutMS: 10000,
    tls: true,
    tlsAllowInvalidCertificates: true,
  })
  promise.catch(() => { global._mongooseConn = undefined })
  return promise
}

const cached = global._mongooseConn ?? (global._mongooseConn = createConnection())

export default cached
