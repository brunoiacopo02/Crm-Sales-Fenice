import * as dotenv from 'dotenv'
dotenv.config({ path: '.env' })
import { seedConfermeKpiData } from './seedConfermeKpiLogic'

seedConfermeKpiData().catch(console.error)
