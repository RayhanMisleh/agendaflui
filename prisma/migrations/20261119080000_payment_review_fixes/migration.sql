-- Achados da revisão do pagamento: pagamento em dobro vira uma atenção do pedido e o prazo mínimo para pagar sobe para 30 minutos (Pix).

ALTER TABLE "orders" DROP CONSTRAINT "orders_attention_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_attention_check" CHECK ("attention" IS NULL OR "attention" IN ('amount_mismatch', 'stock_shortfall', 'payment_reversed', 'double_payment'));

-- Contas com prazo menor sobem para 30 minutos antes de o CHECK novo valer.
UPDATE "store_settings" SET "payment_window_min" = 30 WHERE "payment_window_min" < 30;
ALTER TABLE "store_settings" DROP CONSTRAINT "store_settings_payment_window_check";
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_payment_window_check" CHECK ("payment_window_min" BETWEEN 30 AND 1440);
