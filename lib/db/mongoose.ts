import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI!

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is not set')
}

declare global {
  // eslint-disable-next-line no-var
  var _mongooseConn: Promise<typeof mongoose> | undefined
}

function connect() {
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

// Use a getter so each `await dbConnect` re-checks global state.
// If a previous connection attempt failed and cleared _mongooseConn, this retries.
const dbConnect = {
  then: (onfulfilled?: ((value: typeof mongoose) => unknown) | null, onrejected?: ((reason: unknown) => unknown) | null) => {
    if (!global._mongooseConn) global._mongooseConn = connect()
    return global._mongooseConn.then(onfulfilled ?? undefined, onrejected ?? undefined)
  },
  catch: (onrejected?: ((reason: unknown) => unknown) | null) => {
    if (!global._mongooseConn) global._mongooseConn = connect()
    return global._mongooseConn.catch(onrejected ?? undefined)
  },
}

export default dbConnect
