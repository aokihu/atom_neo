import { createContext, useContext } from "react";

const ModalOpenContext = createContext(false);
export const ModalOpenProvider = ModalOpenContext.Provider;
export const useModalOpen = () => useContext(ModalOpenContext);
