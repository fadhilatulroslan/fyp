-- Run once in Supabase SQL Editor before flashing the firmware update.
-- Leaves existing records and access policies unchanged; old rows have NULL outputs.
ALTER TABLE public.sensor_data
  ADD COLUMN IF NOT EXISTS hardware_outputs jsonb;
NOTIFY pgrst, 'reload schema';
