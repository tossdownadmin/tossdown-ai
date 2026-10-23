import { SessionProvider } from "next-auth/react";
import Chat from "../components/chat";
export default function Page(){return <SessionProvider><Chat/></SessionProvider>}
