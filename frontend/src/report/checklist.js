// Omada setup checklist for a chosen layout (spec Phase 7 §6).

export function omadaChecklist(option, apModel, existingAps) {
  const n = option.aps.length
  const eap773 = apModel?.key === 'tplink_eap773'
  const old = existingAps.map((a) => a.label).join(', ')
  return [
    {
      title: 'Hardware & power',
      items: [
        `${n} × ${apModel?.name ?? 'Omada AP'}, ceiling-mounted at the spots shown (cable to each from your switch).`,
        eap773
          ? 'EAP773 can draw ~26 W at full function — use 802.3bt (PoE++) ports or injectors, or confirm what it disables on 802.3at.'
          : 'EAP772 runs on 802.3at (PoE+); budget about 25 W per AP on the switch.',
        'Uplink: 2.5 GbE (EAP772) / 10 GbE (EAP773) only helps if the switch port and the path to the router are multi-gig.',
        'Controller: Omada software controller, hardware controller (OC-series) or the Omada app in standalone mode — adopt all APs before tuning.',
      ],
    },
    {
      title: 'Before you switch over',
      items: [
        'Test the top spot first: power one AP temporarily at New AP 1 (PoE injector + ladder is fine), give it a test network name, and run an "AP-on-a-stick" survey from Floor Plans → Survey. Re-plan with the real readings before mounting the rest.',
        old ? `Retire or turn off Wi-Fi on the current units (${old}) once the Omada APs are up — leaving them on adds the same co-channel contention the baseline found.` : null,
        'Keep the dedicated router as the gateway/DHCP server; set the Omada APs to bridge (AP) mode on the same LAN.',
      ].filter(Boolean),
    },
    {
      title: 'Wireless networks',
      items: [
        'One main network name across 2.4, 5 and 6 GHz, WPA2/WPA3 Personal (transition) — 6 GHz itself requires WPA3, so older devices will simply use 2.4/5.',
        'Enable MLO (Multi-Link Operation) on the main network for Wi-Fi 7 clients.',
        'Optional: a separate 2.4 GHz-only WPA2 network for smart-home gadgets that dislike band steering or WPA3.',
        'Turn on Fast Roaming (802.11r) together with 802.11k/v (Omada: "Fast Roaming" + "AI Roaming"). If an old device misbehaves, try it without 11r first.',
        'Band steering: prefer 5/6 GHz.',
      ],
    },
    {
      title: 'Channels & power per AP',
      table: {
        head: ['AP', 'Where', '2.4 GHz', '5 GHz', '6 GHz'],
        rows: option.aps.map((ap, i) => [
          `New AP ${i + 1}`,
          `${ap.floor} · ${ap.room}`,
          `ch ${ap.channels['2.4'].channel} · 20 MHz · low`,
          `ch ${ap.channels['5'].channel} (${ap.channels['5'].block}) · 80 MHz${ap.channels['5'].dfs ? ' · DFS' : ''}`,
          `ch ${ap.channels['6'].channel} · 160 MHz`,
        ]),
      },
      items: [
        'Set channels manually as above (or lock Omada\'s auto channel to these after it settles) so no two APs share a channel.',
        'Transmit power: 5/6 GHz around 16 dBm ("Medium"), 2.4 GHz around 12 dBm ("Low"). Higher power looks better on paper but devices cannot answer back as loudly, and they cling to far APs.',
        option.aps[0]?.channels['6'].note ? `6 GHz: ${option.aps[0].channels['6'].note}.` : null,
        option.aps.some((a) => a.channels['5'].dfs) ? 'DFS channels (52-144) pause for about a minute if radar is detected. If that AP drops out, move it to a 5 GHz block none of the other APs use; 36-48 was busy with other networks in the baseline.' : null,
        'Minimum RSSI / client steering: leave off at first. If a device clings to a distant AP, set a 2.4 GHz minimum around −75 dBm.',
      ].filter(Boolean),
    },
    {
      title: 'Validate',
      items: [
        'After mounting, run a "Validation" survey from Floor Plans → Survey on the same spots and compare it with the baseline in a new report.',
        'Re-run the survey at a different time of day if channel choice matters — neighbours\' networks change.',
      ],
    },
  ]
}
