INSERT INTO users(phone,name,role,shop_id) VALUES
('0600000001','Client Test','client',NULL),('0600000002','Marchand Test','merchant',1),
('0600000003','Livreur Test','courier',NULL),('0600000004','Admin Test','admin',NULL)
ON CONFLICT(phone) DO NOTHING;
