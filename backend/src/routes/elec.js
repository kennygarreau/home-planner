const express = require('express')

const DEFAULT_LOADS = [
  { id: 1,  name: 'HVAC / Heat Pump',        amps: '30', volts: 240, qty: 1, continuous: true  },
  { id: 2,  name: 'Electric Range',           amps: '50', volts: 240, qty: 1, continuous: false },
  { id: 3,  name: 'Water Heater (electric)',  amps: '25', volts: 240, qty: 1, continuous: false },
  { id: 4,  name: 'Clothes Dryer',            amps: '30', volts: 240, qty: 1, continuous: false },
  { id: 5,  name: 'Washer',                   amps: '20', volts: 120, qty: 1, continuous: false },
  { id: 6,  name: 'Dishwasher',               amps: '15', volts: 120, qty: 1, continuous: false },
  { id: 7,  name: 'Refrigerator',             amps: '6',  volts: 120, qty: 1, continuous: false },
  { id: 8,  name: 'Microwave',                amps: '15', volts: 120, qty: 1, continuous: false },
  { id: 9,  name: 'Lighting / Receptacles',   amps: '15', volts: 120, qty: 4, continuous: true  },
  { id: 10, name: 'Kitchen Small Appliances', amps: '20', volts: 120, qty: 2, continuous: false },
]

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      let scenario = await prisma.elecScenario.findUnique({ where: { id: 1 } })
      if (!scenario) {
        scenario = await prisma.elecScenario.create({
          data: { id: 1, panelAmps: 200, loads: DEFAULT_LOADS, subPanels: [] },
        })
      }
      res.json(scenario)
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.put('/', async (req, res) => {
    try {
      const { panelAmps, sqft, smallAppCircuits, laundry, loads, subPanels } = req.body
      if (!Array.isArray(loads)) return res.status(400).json({ error: 'loads must be an array' })
      if (!Array.isArray(subPanels)) return res.status(400).json({ error: 'subPanels must be an array' })
      const data = {
        panelAmps: parseInt(panelAmps) || 200,
        sqft: parseInt(sqft) || 0,
        smallAppCircuits: parseInt(smallAppCircuits) ?? 2,
        laundry: laundry !== false,
        loads,
        subPanels,
      }
      const scenario = await prisma.elecScenario.upsert({
        where: { id: 1 },
        update: data,
        create: { id: 1, ...data },
      })
      res.json(scenario)
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}
