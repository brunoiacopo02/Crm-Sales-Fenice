import { db } from "./index"
import { users } from "./schema"

const res = await db.select({
    displayName: users.displayName,
    isActive: users.isActive,
    rawIsActiveType: typeof users.isActive
}).from(users)

console.log(res)
