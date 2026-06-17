// Curated "Yearly Strongest" study list — the dominant market theme of each
// year plus the most obvious / studyable stock ascendants behind it.
//
// This is hand-curated reference content, NOT live market data. Gains are
// approximate full-year (or year-to-date for the current year) moves rounded
// for study purposes — verify exact numbers before trading off them. To update
// a year, just edit its entry below; the page renders straight from this array.
//
// Sources of the picks: best-performing S&P 500 / notable large-cap momentum
// leaders each year and the narrative that drove them. Newest year first.

export const YEARLY_STRONGEST = [
  {
    year: 2026,
    partial: true,
    theme: 'AI Storage Supercycle',
    tagline: 'Memory & disk shortage — NAND, HBM, HDD',
    summary:
      'The AI data-center buildout outran the world’s ability to make memory and storage. HBM, NAND flash and even nearline hard drives went into structural shortage, handing pricing power to every storage maker. The cleanest trade of the year was simply "own the bytes."',
    stocks: [
      { ticker: 'SNDK', name: 'SanDisk', gain: 'Leader', reason: 'NAND flash pure-play (spun out of Western Digital in early 2025). Tight supply + AI demand drove repeated price hikes and a re-rating off a low base.' },
      { ticker: 'MU', name: 'Micron Technology', gain: 'Leader', reason: 'HBM for AI accelerators plus DRAM/NAND pricing at records. The US memory champion and the bellwether for the whole theme.' },
      { ticker: 'WDC', name: 'Western Digital', gain: 'Leader', reason: 'Nearline HDD shortage — AI data centers need vast cheap "cold" storage, and disk capacity sold out, lifting margins.' },
      { ticker: 'STX', name: 'Seagate', gain: 'Leader', reason: 'The other HDD duopolist; same nearline shortage, multi-quarter pricing power and HAMR high-capacity drive ramp.' },
      { ticker: 'PSTG', name: 'Pure Storage', gain: 'Strong', reason: 'Enterprise all-flash arrays with hyperscaler design wins displacing HDD for some AI workloads.' },
      { ticker: 'NTAP', name: 'NetApp', gain: 'Strong', reason: 'Enterprise storage riding the same data-growth + AI tailwind.' },
      { ticker: 'NVDA', name: 'NVIDIA', gain: 'Core', reason: 'Still the spine of the AI buildout that creates all this storage demand; every memory cycle traces back to GPU shipments.' },
      { ticker: 'AVGO', name: 'Broadcom', gain: 'Core', reason: 'Custom AI silicon + networking; the second pillar of AI infrastructure alongside NVIDIA.' },
    ],
  },
  {
    year: 2025,
    verified: true,
    theme: 'AI Buildout Goes Physical — Power, Memory & Neoclouds',
    tagline: 'Nuclear, memory/storage and GPU-clouds lead',
    summary:
      'The AI trade moved into the physical layer: the electricity to run it (nuclear / SMRs), the memory and storage to feed it (the start of the storage supercycle), and the GPU "neoclouds" renting out compute. Quantum names and Robinhood added speculative fuel, while last year’s crypto-treasury darlings (MSTR, COIN) faded. Figures below are market-verified full-year 2025 returns.',
    stocks: [
      { ticker: 'OKLO', name: 'Oklo', gain: '+228%', reason: 'Advanced nuclear / small modular reactors — the lead "AI power" name as data-center electricity demand became the year’s obsession.' },
      { ticker: 'MU', name: 'Micron', gain: '+227%', reason: 'HBM + DRAM/NAND pricing turned up hard on AI memory demand — the first leg of the memory/storage supercycle.' },
      { ticker: 'STX', name: 'Seagate', gain: '+219%', reason: 'Nearline HDD demand for AI "cold" storage tightened supply — the storage theme began here, a year before it peaked.' },
      { ticker: 'APLD', name: 'Applied Digital', gain: '+214%', reason: 'AI data-center / neocloud buildout; signed large hyperscaler capacity leases.' },
      { ticker: 'HOOD', name: 'Robinhood', gain: '+187%', reason: 'Retail-trading + crypto boom; record volumes, new products and S&P 500 inclusion.' },
      { ticker: 'WDC', name: 'Western Digital', gain: '+178%', reason: 'The other side of the HDD/NAND shortage; the SanDisk spinoff sharpened the storage story.' },
      { ticker: 'NBIS', name: 'Nebius Group', gain: '+174%', reason: 'European AI "neocloud" renting GPU capacity — one of the year’s premier compute-supply plays.' },
      { ticker: 'QBTS', name: 'D-Wave Quantum', gain: '+172%', reason: 'The standout of the speculative quantum-computing run that gripped retail in 2025.' },
      { ticker: 'PLTR', name: 'Palantir', gain: '+136%', reason: 'Still the market’s favorite AI-software name; commercial AIP adoption + relentless multiple expansion.' },
      { ticker: 'APP', name: 'AppLovin', gain: '+97%', reason: 'AI-driven ad engine (AXON) kept compounding after a monster 2024; joined the S&P 500.' },
    ],
  },
  {
    year: 2024,
    theme: 'AI Infrastructure Broadens — Power, Data Centers, Crypto',
    tagline: 'The trade widens from chips to electricity and bitcoin',
    summary:
      'AI stopped being just a chip story. The market re-rated everything that feeds a data center — power producers, grid equipment, custom silicon — while bitcoin hit records after spot-ETF approval and the US election. The standout was the emergence of "AI power" (nuclear/utilities) as a brand-new momentum complex.',
    stocks: [
      { ticker: 'PLTR', name: 'Palantir', gain: '+340%', reason: 'Best S&P 500 performer of 2024. Commercial AIP adoption inflected; added to the S&P 500 and Nasdaq-100.' },
      { ticker: 'VST', name: 'Vistra', gain: '+258%', reason: 'The breakout "AI power" name — independent power producer whose nuclear/gas fleet became the way to play data-center electricity.' },
      { ticker: 'APP', name: 'AppLovin', gain: '+700%', reason: 'The momentum trade of the year; its AXON AI ad engine drove explosive revenue and margin gains.' },
      { ticker: 'NVDA', name: 'NVIDIA', gain: '+171%', reason: 'Blackwell ramp, continued AI-GPU dominance; briefly the world’s most valuable company.' },
      { ticker: 'MSTR', name: 'MicroStrategy', gain: '+350%', reason: 'Leveraged bitcoin treasury play; rallied with bitcoin’s post-ETF and post-election surge.' },
      { ticker: 'GEV', name: 'GE Vernova', gain: '+150%', reason: 'Power & grid-equipment spinoff; pure electrification + data-center power demand play.' },
      { ticker: 'AVGO', name: 'Broadcom', gain: '+110%', reason: 'Custom AI accelerators (XPUs) + networking; crossed a $1T market cap.' },
      { ticker: 'CEG', name: 'Constellation Energy', gain: '+90%', reason: 'Nuclear PPAs for hyperscalers, including the Three Mile Island restart deal with Microsoft.' },
      { ticker: 'AXON', name: 'Axon Enterprise', gain: '+130%', reason: 'Taser + AI policing/records software; durable recurring-revenue compounder.' },
      { ticker: 'TPL', name: 'Texas Pacific Land', gain: '+110%', reason: 'Permian land/royalties plus optionality on selling land for data centers and water.' },
    ],
  },
  {
    year: 2023,
    theme: 'Generative AI & the Magnificent Seven',
    tagline: 'ChatGPT goes mainstream; mega-cap tech roars back',
    summary:
      'After a brutal 2022, the year ChatGPT captured the world’s imagination. AI demand turned NVIDIA into a generational winner, mega-cap tech ("Magnificent Seven") drove almost the entire index gain, and beaten-down 2022 names staged violent short-squeeze recoveries.',
    stocks: [
      { ticker: 'NVDA', name: 'NVIDIA', gain: '+239%', reason: 'Best mega-cap of the year. AI-GPU (H100) demand exploded; data-center revenue tripled and guidance blew past every estimate.' },
      { ticker: 'META', name: 'Meta Platforms', gain: '+194%', reason: '"Year of Efficiency" — massive cost cuts + an ad-revenue recovery after the 2022 collapse.' },
      { ticker: 'CVNA', name: 'Carvana', gain: '+1,000%', reason: 'From bankruptcy fears to a debt restructuring + epic short squeeze — the comeback of the year.' },
      { ticker: 'COIN', name: 'Coinbase', gain: '+391%', reason: 'Crypto recovery; bitcoin rebounded and the spot-ETF narrative built through the year.' },
      { ticker: 'SMCI', name: 'Super Micro Computer', gain: '+246%', reason: 'The pick-and-shovel AI-server builder riding NVIDIA’s GPU shipments.' },
      { ticker: 'PLTR', name: 'Palantir', gain: '+167%', reason: 'Launched AIP and posted its first GAAP-profitable quarters — got the AI re-rating.' },
      { ticker: 'RCL', name: 'Royal Caribbean', gain: '+162%', reason: 'Cruise/travel demand normalized post-COVID; bookings and pricing surged.' },
      { ticker: 'AMD', name: 'Advanced Micro Devices', gain: '+128%', reason: 'AI-accelerator optimism around the MI300 launch as the #2 to NVIDIA.' },
      { ticker: 'AVGO', name: 'Broadcom', gain: '+100%', reason: 'AI networking demand + the VMware acquisition closing.' },
      { ticker: 'TSLA', name: 'Tesla', gain: '+102%', reason: 'Sharp recovery rally off 2022’s washout as risk appetite returned.' },
    ],
  },
  {
    year: 2022,
    theme: 'Energy Dominance in a Bear Market',
    tagline: 'Oil & gas the only thing green',
    summary:
      'The Fed hiked rates at the fastest pace in decades to fight 40-year-high inflation, crushing growth and tech. Energy was the ONLY S&P 500 sector up on the year — Russia’s invasion of Ukraine spiked oil and gas, handing producers record profits. Defensives and the new "clean power" names also held up.',
    stocks: [
      { ticker: 'OXY', name: 'Occidental Petroleum', gain: '+119%', reason: 'Best S&P 500 performer of 2022. Record oil profits + Buffett/Berkshire became a relentless buyer.' },
      { ticker: 'HES', name: 'Hess', gain: '+94%', reason: 'World-class Guyana oil discoveries on top of the energy bull market.' },
      { ticker: 'XOM', name: 'ExxonMobil', gain: '+80%', reason: 'Record full-year profit; the mega-cap face of the energy windfall.' },
      { ticker: 'MPC', name: 'Marathon Petroleum', gain: '+76%', reason: 'Refining "crack spreads" blew out to historic levels.' },
      { ticker: 'SLB', name: 'SLB (Schlumberger)', gain: '+76%', reason: 'Oilfield-services upcycle as producers ramped capex.' },
      { ticker: 'COP', name: 'ConocoPhillips', gain: '+72%', reason: 'Pure-play E&P leveraged to high oil and disciplined returns.' },
      { ticker: 'HAL', name: 'Halliburton', gain: '+73%', reason: 'Services demand surged with North American drilling activity.' },
      { ticker: 'CEG', name: 'Constellation Energy', gain: '+100%', reason: 'Newly spun-out nuclear/clean-power utility; high power prices + the Inflation Reduction Act.' },
      { ticker: 'FSLR', name: 'First Solar', gain: '+72%', reason: 'The Inflation Reduction Act’s domestic-solar subsidies re-rated US panel makers.' },
      { ticker: 'MCK', name: 'McKesson', gain: '+45%', reason: 'Classic defensive healthcare-distribution winner in a risk-off year.' },
    ],
  },
  {
    year: 2021,
    theme: 'Meme Stocks, Reopening & Energy',
    tagline: 'Retail revolt, the reopening trade and oil’s comeback',
    summary:
      'Stimulus-fueled retail traders launched the meme-stock revolution (GME, AMC), the economy reopened, and inflation began to bite. Energy roared back from the 2020 collapse — the year’s best S&P names were oil producers — while EV and cybersecurity momentum continued.',
    stocks: [
      { ticker: 'GME', name: 'GameStop', gain: '+688%', reason: 'The original meme squeeze — a Reddit-driven short squeeze that rewired retail trading culture.' },
      { ticker: 'AMC', name: 'AMC Entertainment', gain: '+1,180%', reason: 'The other meme-squeeze icon; the company raised capital into the frenzy to survive.' },
      { ticker: 'DVN', name: 'Devon Energy', gain: '+189%', reason: 'Best S&P 500 performer of 2021. Oil recovery + pioneering "fixed-plus-variable" dividend.' },
      { ticker: 'MRO', name: 'Marathon Oil', gain: '+147%', reason: 'High-beta oil producer levered straight to the energy reopening.' },
      { ticker: 'FTNT', name: 'Fortinet', gain: '+142%', reason: 'Cybersecurity demand surged as digital attack surfaces exploded.' },
      { ticker: 'F', name: 'Ford', gain: '+136%', reason: 'EV pivot caught fire — F-150 Lightning and Mustang Mach-E re-rated the stock.' },
      { ticker: 'NVDA', name: 'NVIDIA', gain: '+125%', reason: 'Continued data-center and gaming-GPU growth; pre-AI but already a momentum leader.' },
      { ticker: 'NUE', name: 'Nucor', gain: '+116%', reason: 'Steel prices spiked on reopening demand + infrastructure optimism.' },
      { ticker: 'BBWI', name: 'Bath & Body Works', gain: '+105%', reason: 'Consumer-spending boom + the L Brands split unlocked value.' },
      { ticker: 'MSTR', name: 'MicroStrategy', gain: '+~40%', reason: 'Became the leveraged bitcoin proxy as crypto ran; Coinbase also IPO’d this year.' },
    ],
  },
  {
    year: 2020,
    theme: 'Pandemic, Work-From-Home & EV Mania',
    tagline: 'Lockdown tech and the electric-vehicle bubble',
    summary:
      'A March COVID crash followed by unprecedented stimulus and zero rates created a stay-at-home tech and EV bubble. Anything tied to remote work, vaccines, e-commerce or clean energy went vertical, and a flood of new retail traders poured in.',
    stocks: [
      { ticker: 'TSLA', name: 'Tesla', gain: '+743%', reason: 'The stock of the year — surging EV demand, S&P 500 inclusion and a retail frenzy; the 5-for-1 split added fuel.' },
      { ticker: 'NIO', name: 'NIO', gain: '+1,110%', reason: 'Chinese EV maker rescued from near-bankruptcy by a bailout, then rode the EV mania.' },
      { ticker: 'PLUG', name: 'Plug Power', gain: '+970%', reason: 'Hydrogen / clean-energy hype as the green-transition trade took off.' },
      { ticker: 'ENPH', name: 'Enphase Energy', gain: '+570%', reason: 'Solar microinverters; the clean-energy boom’s top quality compounder.' },
      { ticker: 'MRNA', name: 'Moderna', gain: '+434%', reason: 'mRNA COVID-19 vaccine took it from biotech hopeful to household name.' },
      { ticker: 'PTON', name: 'Peloton', gain: '+434%', reason: 'Home-fitness boom while gyms were closed — the archetypal lockdown winner.' },
      { ticker: 'ZM', name: 'Zoom Video', gain: '+396%', reason: 'Video calls became the infrastructure of remote work and school overnight.' },
      { ticker: 'SE', name: 'Sea Limited', gain: '+395%', reason: 'Southeast-Asian e-commerce (Shopee) + gaming (Free Fire) hyper-growth.' },
      { ticker: 'DOCU', name: 'DocuSign', gain: '+200%', reason: 'E-signature became essential for a world that couldn’t meet in person.' },
      { ticker: 'SQ', name: 'Block (Square)', gain: '+248%', reason: 'Cash App + bitcoin exposure rode the fintech and crypto surge.' },
    ],
  },
  {
    year: 2019,
    theme: 'Semiconductor & Momentum-Tech Rebound',
    tagline: 'Chips lead, SaaS and streaming fly',
    summary:
      'After the Q4-2018 selloff, the Fed pivoted dovish and the S&P jumped ~29%. A semiconductor cyclical upturn (with early data-center optimism) led the market, while high-growth SaaS, streaming and consumer-turnaround names produced the biggest individual moves.',
    stocks: [
      { ticker: 'ROKU', name: 'Roku', gain: '+337%', reason: 'Cord-cutting / connected-TV platform hyper-growth — the streaming-wars pick-and-shovel.' },
      { ticker: 'SHOP', name: 'Shopify', gain: '+180%', reason: 'E-commerce SaaS; explosive merchant growth made it the "arm the rebels" play vs Amazon.' },
      { ticker: 'AMD', name: 'Advanced Micro Devices', gain: '+148%', reason: 'Best S&P 500 performer of 2019. Ryzen/EPYC 7nm leadership took share from Intel.' },
      { ticker: 'LRCX', name: 'Lam Research', gain: '+115%', reason: 'Semiconductor-equipment upcycle as memory capex recovered.' },
      { ticker: 'KLAC', name: 'KLA Corp', gain: '+98%', reason: 'Same semicap upcycle — chip-inspection demand rebounded.' },
      { ticker: 'CMG', name: 'Chipotle', gain: '+94%', reason: 'Turnaround after the food-safety crisis; digital ordering reignited growth.' },
      { ticker: 'TGT', name: 'Target', gain: '+94%', reason: 'Omnichannel retail turnaround — same-day fulfillment and store-pickup paid off.' },
      { ticker: 'AAPL', name: 'Apple', gain: '+86%', reason: 'Services-pivot re-rating + huge buybacks; the "wearables + services" growth story.' },
      { ticker: 'NVDA', name: 'NVIDIA', gain: '+76%', reason: 'Recovered from the 2018 crypto hangover as data-center growth reaccelerated.' },
      { ticker: 'AMAT', name: 'Applied Materials', gain: '+85%', reason: 'Broad semicap-equipment recovery alongside Lam and KLA.' },
    ],
  },
  {
    year: 2018,
    theme: 'Cloud/SaaS & AMD Amid the Selloff',
    tagline: 'A down year — only secular growth survived',
    summary:
      'The first down year for the S&P 500 since 2008, capped by a brutal Q4 crash on rising rates and the US–China trade war. The few winners were high-growth cloud/SaaS names, a resurgent AMD, and classic defensives — momentum survived where cyclicals broke.',
    stocks: [
      { ticker: 'TWLO', name: 'Twilio', gain: '+275%', reason: 'Communications-API cloud darling; the breakout SaaS story of the year as developers built on it.' },
      { ticker: 'AMD', name: 'Advanced Micro Devices', gain: '+80%', reason: 'Best S&P 500 performer of 2018. Ryzen/EPYC share gains made it the lone cyclical winner.' },
      { ticker: 'OKTA', name: 'Okta', gain: '+105%', reason: 'Identity/access cloud platform; secular security-software growth shrugged off the selloff.' },
      { ticker: 'TEAM', name: 'Atlassian', gain: '+50%', reason: 'Developer-collaboration SaaS (Jira/Confluence) — durable subscription growth.' },
      { ticker: 'NOW', name: 'ServiceNow', gain: '+30%', reason: 'Enterprise workflow cloud kept compounding through the volatility.' },
      { ticker: 'ABMD', name: 'Abiomed', gain: '+45%', reason: 'Impella heart-pump medtech; high-growth healthcare that dodged the cyclical pain.' },
      { ticker: 'FTNT', name: 'Fortinet', gain: '+27%', reason: 'Cybersecurity demand proved recession-resistant.' },
      { ticker: 'CMG', name: 'Chipotle', gain: '+49%', reason: 'Turnaround re-accelerated under new management + digital ordering.' },
      { ticker: 'MRK', name: 'Merck', gain: '+36%', reason: 'Keytruda oncology blockbuster made it the defensive pharma winner.' },
      { ticker: 'AAP', name: 'Advance Auto Parts', gain: '+62%', reason: 'Margin turnaround in a recession-resistant auto-parts retailer.' },
    ],
  },
  {
    year: 2017,
    theme: 'FAANG Melt-Up & the Crypto Boom',
    tagline: 'Low-vol grind higher; Bitcoin goes parabolic',
    summary:
      'A famously calm, steady melt-up on synchronized global growth (+19% with almost no drawdowns). Mega-cap "FAANG" tech led, semiconductors ran, and Bitcoin went parabolic from ~$1k to ~$20k — minting the first wave of crypto-mania stocks.',
    stocks: [
      { ticker: 'ALGN', name: 'Align Technology', gain: '+131%', reason: 'Best S&P 500 performer of 2017. Invisalign clear-aligner demand exploded globally.' },
      { ticker: 'NVDA', name: 'NVIDIA', gain: '+82%', reason: 'Gaming + data-center + crypto-mining GPU demand; the emerging momentum leader.' },
      { ticker: 'MU', name: 'Micron', gain: '+88%', reason: 'Memory super-cycle — DRAM/NAND pricing surged on data-center and mobile demand.' },
      { ticker: 'BA', name: 'Boeing', gain: '+89%', reason: 'Record commercial-aircraft backlog + strong free cash flow drove a blue-chip melt-up.' },
      { ticker: 'WYNN', name: 'Wynn Resorts', gain: '+94%', reason: 'Macau gaming recovery roared back.' },
      { ticker: 'NFLX', name: 'Netflix', gain: '+55%', reason: 'Subscriber growth + original content; the "N" in FAANG kept compounding.' },
      { ticker: 'AMZN', name: 'Amazon', gain: '+56%', reason: 'E-commerce + AWS cloud; crossed $1,000/share and bought Whole Foods.' },
      { ticker: 'VRTX', name: 'Vertex Pharmaceuticals', gain: '+100%', reason: 'Cystic-fibrosis franchise data drove the biotech standout.' },
      { ticker: 'TTWO', name: 'Take-Two Interactive', gain: '+122%', reason: 'GTA Online + NBA 2K live-services revenue re-rated the gaming publisher.' },
      { ticker: 'RIOT', name: 'Riot Blockchain', gain: '+500%+', reason: 'Poster child of the 2017 crypto-mania — a company that pivoted to "blockchain" and went vertical with Bitcoin.' },
    ],
  },
  {
    year: 2016,
    theme: 'Reflation & the Commodities Comeback',
    tagline: 'Brexit, Trump, and a bottom in oil & metals',
    summary:
      'A V-shaped year: a January commodity-crash scare bottomed, then Brexit and the Trump election ignited a "reflation" trade. Energy, metals and miners bounced hardest off the bottom, banks ripped post-election, and NVIDIA quietly became the year’s best stock.',
    stocks: [
      { ticker: 'NVDA', name: 'NVIDIA', gain: '+224%', reason: 'Best S&P 500 performer of 2016. Gaming + the first wave of deep-learning/data-center GPU demand.' },
      { ticker: 'FCX', name: 'Freeport-McMoRan', gain: '+95%', reason: 'Copper/commodity recovery off the early-2016 bottom — the reflation poster child.' },
      { ticker: 'NEM', name: 'Newmont', gain: '+90%', reason: 'Gold miners surged in the first half as bullion rallied.' },
      { ticker: 'AMAT', name: 'Applied Materials', gain: '+74%', reason: 'Semiconductor-equipment upcycle (displays + memory capex).' },
      { ticker: 'MU', name: 'Micron', gain: '+58%', reason: 'Memory pricing bottomed and turned; cyclical recovery began.' },
      { ticker: 'OKE', name: 'ONEOK', gain: '+133%', reason: 'Midstream energy bounce as oil & gas stabilized.' },
      { ticker: 'CAT', name: 'Caterpillar', gain: '+38%', reason: 'Reflation/infrastructure trade lifted the cyclical bellwether post-election.' },
      { ticker: 'BAC', name: 'Bank of America', gain: '+33%', reason: 'Banks ripped after the election on higher-rate and deregulation hopes.' },
      { ticker: 'X', name: 'United States Steel', gain: '+330%', reason: 'Steel exploded off the bottom on commodity reflation + trade-protection hopes.' },
      { ticker: 'HAL', name: 'Halliburton', gain: '+40%', reason: 'Oil-services recovery as crude doubled off its February lows.' },
    ],
  },
  {
    year: 2015,
    theme: 'The Rise of FANG',
    tagline: 'A flat market carried by four names',
    summary:
      'A flat, narrow year (S&P roughly unchanged) with terrible breadth — almost the entire index gain came from "FANG" (Facebook, Amazon, Netflix, Google). Energy and commodities collapsed; large-cap secular tech was the only place to hide.',
    stocks: [
      { ticker: 'NFLX', name: 'Netflix', gain: '+134%', reason: 'Best S&P 500 performer of 2015. International expansion + the streaming land-grab.' },
      { ticker: 'AMZN', name: 'Amazon', gain: '+118%', reason: 'AWS profitability was revealed for the first time — the stock re-rated violently.' },
      { ticker: 'ATVI', name: 'Activision Blizzard', gain: '+92%', reason: 'Hit franchises + the King (Candy Crush) acquisition; gaming as a growth story.' },
      { ticker: 'NVDA', name: 'NVIDIA', gain: '+67%', reason: 'Gaming GPUs + early data-center traction began NVIDIA’s multi-year run.' },
      { ticker: 'GOOGL', name: 'Alphabet', gain: '+47%', reason: 'The "G" in FANG; ad growth + the Alphabet reorganization and cost discipline.' },
      { ticker: 'FB', name: 'Facebook', gain: '+34%', reason: 'Mobile-ad monetization inflected; the "F" in FANG.' },
      { ticker: 'AVGO', name: 'Broadcom (Avago)', gain: '+45%', reason: 'Serial-acquirer chip roll-up; announced the transformational Broadcom deal.' },
      { ticker: 'VRSN', name: 'VeriSign', gain: '+42%', reason: 'Domain-registry monopoly economics — a quiet defensive compounder.' },
      { ticker: 'SBUX', name: 'Starbucks', gain: '+47%', reason: 'Mobile order-and-pay + loyalty drove a premium-consumer standout.' },
      { ticker: 'RAI', name: 'Reynolds American', gain: '+40%', reason: 'Tobacco/defensive winner with the Lorillard acquisition in a risk-off tape.' },
    ],
  },
  {
    year: 2014,
    theme: 'Airlines & Biotech — Cheap Oil, Big Pharma Innovation',
    tagline: 'Oil crashed; airlines and biotech flew',
    summary:
      'A steady up year (+11%) split in two: a biotech boom in the first half (Gilead’s hepatitis-C cure) and an oil crash in the second half that handed airlines a windfall on collapsing fuel costs. Healthcare innovation and lower energy prices were the threads.',
    stocks: [
      { ticker: 'LUV', name: 'Southwest Airlines', gain: '+126%', reason: 'Best S&P 500 performer of 2014. Collapsing jet-fuel costs supercharged airline margins.' },
      { ticker: 'EA', name: 'Electronic Arts', gain: '+105%', reason: 'Console-cycle turnaround + digital/live-services revenue.' },
      { ticker: 'AVGO', name: 'Avago Technologies', gain: '+90%', reason: 'Chip roll-up with Apple-iPhone RF content + acquisition synergies.' },
      { ticker: 'EW', name: 'Edwards Lifesciences', gain: '+90%', reason: 'Transcatheter heart-valve (TAVR) adoption drove medtech outperformance.' },
      { ticker: 'AAL', name: 'American Airlines', gain: '+112%', reason: 'Post-merger consolidation + cheap fuel — the airline trade of the year.' },
      { ticker: 'GILD', name: 'Gilead Sciences', gain: '+25%', reason: 'Sovaldi/Harvoni hepatitis-C cure became one of the fastest drug launches ever.' },
      { ticker: 'AGN', name: 'Allergan', gain: '+92%', reason: 'Botox-maker became a takeover battleground (Valeant/Actavis) — M&A premium.' },
      { ticker: 'MNK', name: 'Mallinckrodt', gain: '+89%', reason: 'Specialty-pharma roll-up riding the 2014 healthcare M&A wave.' },
      { ticker: 'DAL', name: 'Delta Air Lines', gain: '+78%', reason: 'Capacity discipline + fuel tailwind; the legacy-carrier comeback.' },
      { ticker: 'KMX', name: 'CarMax', gain: '+30%', reason: 'Used-car retail benefited from cheap gas and a strong consumer.' },
    ],
  },
  {
    year: 2013,
    theme: 'Momentum Tech, Biotech & the Roaring Bull',
    tagline: 'A +30% year led by high-beta growth',
    summary:
      'One of the great bull years (S&P +30%) on the back of QE and improving growth. Momentum tech, beaten-down turnarounds and a biotech boom produced enormous individual moves — high beta was rewarded all year.',
    stocks: [
      { ticker: 'NFLX', name: 'Netflix', gain: '+298%', reason: 'Best S&P 500 performer of 2013. Streaming subscribers surged + original content ("House of Cards").' },
      { ticker: 'TSLA', name: 'Tesla', gain: '+344%', reason: 'Model S ramp + first profitable quarter turned it into the market’s favorite momentum stock.' },
      { ticker: 'MU', name: 'Micron', gain: '+243%', reason: 'Memory super-cycle began as DRAM supply consolidated (Elpida acquisition).' },
      { ticker: 'BBY', name: 'Best Buy', gain: '+237%', reason: 'Left-for-dead retail turnaround as it fought off "showrooming."' },
      { ticker: 'BIIB', name: 'Biogen', gain: '+95%', reason: 'MS franchise (Tecfidera launch) led the 2013 biotech boom.' },
      { ticker: 'CELG', name: 'Celgene', gain: '+115%', reason: 'Revlimid growth + a strong pipeline — a biotech-bull standout.' },
      { ticker: 'FB', name: 'Facebook', gain: '+105%', reason: 'Recovered from its broken IPO as mobile-ad revenue inflected.' },
      { ticker: 'P', name: 'Pandora Media', gain: '+125%', reason: 'Internet-radio growth story in the early streaming-audio land-grab.' },
      { ticker: 'BA', name: 'Boeing', gain: '+84%', reason: 'Record 787 orders + the broad industrial melt-up.' },
      { ticker: 'DAL', name: 'Delta Air Lines', gain: '+132%', reason: 'Airline-consolidation profitability finally re-rated the sector.' },
    ],
  },
  {
    year: 2012,
    theme: 'Housing & Financials Recovery',
    tagline: 'Homebuilders and banks climb out of the crisis',
    summary:
      'The year the post-financial-crisis recovery became undeniable: housing bottomed and turned, and banks healed. Homebuilders were the runaway leaders and beaten-down financials staged powerful rebounds, while Apple briefly became the most valuable company ever.',
    stocks: [
      { ticker: 'PHM', name: 'PulteGroup', gain: '+188%', reason: 'Best S&P 500 performer of 2012. The housing-recovery poster child as new-home demand turned.' },
      { ticker: 'LEN', name: 'Lennar', gain: '+92%', reason: 'Homebuilder leverage to the housing bottom — orders and pricing inflected.' },
      { ticker: 'BAC', name: 'Bank of America', gain: '+109%', reason: 'Rebounded off crisis-era lows as litigation fears eased and capital rebuilt.' },
      { ticker: 'EXPE', name: 'Expedia', gain: '+131%', reason: 'Online-travel growth + the TripAdvisor spinoff unlocked value.' },
      { ticker: 'WHR', name: 'Whirlpool', gain: '+114%', reason: 'Appliance demand levered directly to the housing recovery.' },
      { ticker: 'S', name: 'Sprint', gain: '+140%', reason: 'Telecom turnaround + the SoftBank investment that recapitalized the carrier.' },
      { ticker: 'AAPL', name: 'Apple', gain: '+31%', reason: 'iPhone 5 cycle briefly made it the most valuable company in history (~$700 pre-split).' },
      { ticker: 'HD', name: 'Home Depot', gain: '+50%', reason: 'Home-improvement spending rebounded alongside housing.' },
      { ticker: 'RF', name: 'Regions Financial', gain: '+78%', reason: 'Regional bank recovery — repaid TARP and re-rated off depressed levels.' },
      { ticker: 'PCLN', name: 'Priceline', gain: '+33%', reason: 'Online-travel compounder; international (Booking.com) growth drove premium returns.' },
    ],
  },
];

// Quick-reference theme map (used for the year-rail subtitles).
export const THEME_BY_YEAR = Object.fromEntries(
  YEARLY_STRONGEST.map((y) => [y.year, y.theme])
);
