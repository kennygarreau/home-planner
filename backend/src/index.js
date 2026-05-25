const express = require('express')
const cors = require('cors')
const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const app = express()
const PORT = process.env.PORT || 3001

// Restrict CORS to same-origin requests (nginx proxies all traffic; this is a backstop)
const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : []
app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : false,
}))
app.use(express.json())

// Routes
app.use('/api/settings', require('./routes/settings')(prisma))
app.use('/api/projects', require('./routes/projects')(prisma))
app.use('/api/backlog', require('./routes/backlog')(prisma))
app.use('/api/benchmarks', require('./routes/benchmarks')(prisma))
app.use('/api/export', require('./routes/export')(prisma))
app.use('/api/homevalue', require('./routes/homevalue')(prisma))
app.use('/api/tasks', require('./routes/tasks')(prisma))
app.use('/api/elec', require('./routes/elec')(prisma))
app.use('/api/manualj', require('./routes/manualj')(prisma))

app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Home Planner API running on port ${PORT}`)
  const count = await prisma.roiBenchmark.count()
  if (count === 0) {
    console.log('Seeding initial data...')
    require('../prisma/seed')
  }
})
