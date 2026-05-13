INSERT INTO bet_type_catalog (code, display_name, digits, outcome_rule, default_odds, min_stake, max_stake)
VALUES
  ('ONE_DIGIT', 'One Digit Tail', 1, 'tail1', 9.0, 1.00, 10000.00),
  ('TWO_STRAIGHT', 'Two Digit Straight', 2, 'tail2', 90.0, 1.00, 10000.00),
  ('THREE_STRAIGHT', 'Three Digit Straight', 3, 'tail3', 900.0, 1.00, 10000.00),
  ('FOUR_STRAIGHT', 'Four Digit Straight', 4, 'tail4', 9000.0, 1.00, 10000.00),
  ('FIVE_STRAIGHT', 'Five Digit Straight', 5, 'tail5', 90000.0, 1.00, 10000.00),
  ('SIX_STRAIGHT', 'Six Digit Straight', 6, 'tail6', 900000.0, 1.00, 10000.00)
ON CONFLICT (code) DO NOTHING;
