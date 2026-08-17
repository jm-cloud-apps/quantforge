import { createContext, useContext } from 'react'

// Reading density for the Rules page.
//
// The page is ~18k words across ~37 screens — built for studying, which is the
// wrong shape for the other use it gets: checking one thing before the bell.
// 'brief' keeps each card's title, tagline and its one-line rule and drops the
// drawn scene plus the Looks like / Means prose, which is where the bulk lives.
//
// Delivered through context rather than a prop so the twelve panels don't each
// have to thread it down to FrameworkCard.
export const DensityContext = createContext('full')

export const useDensity = () => useContext(DensityContext)
