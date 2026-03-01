import { db } from "./index"
import { users } from "./schema"

const data = await db.select({
    displayName: users.displayName,
    isActive: users.isActive,
    gdoCode: users.gdoCode
}).from(users)

data.forEach(d => {
    console.log(`GDO ${d.gdoCode} / ${d.displayName}: isActive =>`, d.isActive, `[Type: ${typeof d.isActive}]`);
})
