import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { getUserCreatures } from "@/app/actions/creatureActions";
import { getAllOffers, getGdoUsersForTrading } from "@/app/actions/tradingActions";
import TradingClient from "./TradingClient";

export default async function TradingPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const role = user.user_metadata?.role;
    if (role !== "GDO") redirect("/");

    const [myCreatures, offers, gdoUsers] = await Promise.all([
        getUserCreatures(user.id),
        getAllOffers(user.id),
        getGdoUsersForTrading(user.id),
    ]);

    return (
        <TradingClient
            userId={user.id}
            myCreatures={myCreatures}
            offers={offers}
            gdoUsers={gdoUsers}
        />
    );
}
