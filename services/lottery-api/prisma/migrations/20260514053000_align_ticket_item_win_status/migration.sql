ALTER TABLE ticket_items
  DROP CONSTRAINT IF EXISTS ticket_items_win_status_check;

ALTER TABLE ticket_items
  ADD CONSTRAINT ticket_items_win_status_check
  CHECK (win_status IN ('PENDING', 'WON', 'LOST'));
