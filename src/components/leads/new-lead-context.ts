import { createContext, useContext } from 'react'

/** Lets any screen (sidebar, pipeline header, empty states) open the New Lead form. */
export const NewLeadContext = createContext<{ openNewLead: () => void }>({ openNewLead: () => {} })

export const useNewLead = () => useContext(NewLeadContext)
