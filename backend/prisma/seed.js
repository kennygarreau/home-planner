const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const benchmarks = [
  { category: 'garage_door', label: 'Garage Door Replacement', roiPercent: 102, avgCost: 4500, notes: 'Consistently highest ROI nationally' },
  { category: 'minor_kitchen', label: 'Minor Kitchen Remodel', roiPercent: 96, avgCost: 28000, notes: 'Refacing, new fixtures, appliances' },
  { category: 'stone_veneer', label: 'Stone Veneer (Exterior)', roiPercent: 153, avgCost: 11000, notes: 'Top curb appeal investment' },
  { category: 'entry_door', label: 'Entry Door Replacement (Steel)', roiPercent: 100, avgCost: 2400, notes: 'High visibility, strong return' },
  { category: 'deck_wood', label: 'Wood Deck Addition', roiPercent: 82, avgCost: 17000, notes: 'Outdoor living adds significant value' },
  { category: 'siding_fiber', label: 'Fiber Cement Siding', roiPercent: 88, avgCost: 20000, notes: 'Durable, high buyer appeal' },
  { category: 'window_vinyl', label: 'Vinyl Window Replacement', roiPercent: 69, avgCost: 20000, notes: 'Energy savings + curb appeal' },
  { category: 'bathroom_mid', label: 'Bathroom Remodel (Mid-Range)', roiPercent: 71, avgCost: 25000, notes: 'Fixtures, tile, vanity' },
  { category: 'bathroom_add', label: 'Bathroom Addition', roiPercent: 54, avgCost: 58000, notes: 'High cost but strong value in low-bath homes' },
  { category: 'major_kitchen', label: 'Major Kitchen Remodel', roiPercent: 38, avgCost: 80000, notes: 'High cost reduces ROI — diminishing returns' },
  { category: 'basement_finish', label: 'Basement Finish', roiPercent: 70, avgCost: 55000, notes: 'Adds livable sq ft, strong return' },
  { category: 'roof_asphalt', label: 'Roof Replacement (Asphalt)', roiPercent: 61, avgCost: 30000, notes: 'Necessary maintenance, moderate ROI' },
  { category: 'hvac', label: 'HVAC Replacement', roiPercent: 85, avgCost: 18000, notes: 'High buyer priority, strong return' },
  { category: 'landscaping', label: 'Landscaping / Curb Appeal', roiPercent: 100, avgCost: 5000, notes: 'One of best dollar-for-dollar improvements' },
  { category: 'paint_interior', label: 'Interior Paint', roiPercent: 107, avgCost: 3000, notes: 'Highest ROI of any project' },
  { category: 'paint_exterior', label: 'Exterior Paint', roiPercent: 55, avgCost: 4500, notes: 'Good curb appeal boost' },
  { category: 'flooring_hardwood', label: 'Hardwood Flooring', roiPercent: 118, avgCost: 8000, notes: 'Buyers love hardwood — often recoups full cost' },
  { category: 'insulation', label: 'Attic Insulation', roiPercent: 100, avgCost: 3000, notes: 'Energy efficiency + comfort' },
  { category: 'smart_home', label: 'Smart Home Upgrades', roiPercent: 50, avgCost: 3000, notes: 'Growing buyer interest but lower direct ROI' },
  { category: 'sunroom', label: 'Sunroom Addition', roiPercent: 49, avgCost: 75000, notes: 'Low ROI but high quality-of-life value' },
  { category: 'pool', label: 'In-Ground Pool', roiPercent: 43, avgCost: 65000, notes: 'Lifestyle purchase — low financial ROI' },
  { category: 'other', label: 'Other / Custom', roiPercent: 60, avgCost: 10000, notes: 'Generic estimate — adjust manually' },
]

async function main() {
  console.log('Seeding ROI benchmarks...')
  for (const b of benchmarks) {
    await prisma.roiBenchmark.upsert({
      where: { category: b.category },
      update: b,
      create: b,
    })
  }

  // Create default settings row
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, homeValue: 0, location: '' },
  })

  console.log(`Seeded ${benchmarks.length} ROI benchmarks.`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
