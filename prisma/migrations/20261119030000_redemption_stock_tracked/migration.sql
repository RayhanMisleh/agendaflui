-- O resgate guarda se o prêmio tinha estoque limitado na hora: cancelar só devolve a unidade nesse caso.
-- Os resgates que já existem ficam como "limitado" (o comportamento de antes: devolve se o prêmio tem estoque hoje).
ALTER TABLE "prize_redemptions" ADD COLUMN "stock_tracked" BOOLEAN NOT NULL DEFAULT true;
