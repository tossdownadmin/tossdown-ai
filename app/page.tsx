import Chat from "../components/chat";
import { SessionProvider } from "next-auth/react";
export default function Page(){return <SessionProvider><Chat/></SessionProvider>}
