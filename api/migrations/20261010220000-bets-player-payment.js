/** @type {import('sequelize-cli').Migration} */
export default {
  async up(queryInterface, Sequelize) {
    const add = (column, def) => queryInterface.addColumn("bets", column, def);
    await add("player_name", { type: Sequelize.STRING(160), allowNull: true });
    await add("phone", { type: Sequelize.STRING(32), allowNull: true });
    await add("method", { type: Sequelize.ENUM("yape", "plin"), allowNull: true });
    await add("operation_number", { type: Sequelize.STRING(64), allowNull: true });
    await add("payment_verified", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await add("cashier_id", {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: "users", key: "id" },
    });
    await add("annul_reason", { type: Sequelize.TEXT, allowNull: true });
    await add("refund_operation_number", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });

    await queryInterface.changeColumn("bets", "side", {
      type: Sequelize.ENUM("red", "blue"),
      allowNull: true,
    });
    // Postgres no permite recrear el ENUM con changeColumn: se agregan valores.
    await queryInterface.sequelize.query(
      `ALTER TYPE enum_bets_status ADD VALUE IF NOT EXISTS 'ANULADA';
       ALTER TYPE enum_bets_status ADD VALUE IF NOT EXISTS 'DEVUELTA';`,
    );

    // R20: número de operación único por método.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX bets_operation_unique ON bets (method, operation_number)
       WHERE operation_number IS NOT NULL;`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      "DROP INDEX IF EXISTS bets_operation_unique;",
    );
    for (const col of [
      "player_name",
      "phone",
      "method",
      "operation_number",
      "payment_verified",
      "cashier_id",
      "annul_reason",
      "refund_operation_number",
    ]) {
      await queryInterface.removeColumn("bets", col);
    }
    // El ENUM no pierde valores (Postgres no soporta quitarlos).
    await queryInterface.changeColumn("bets", "side", {
      type: Sequelize.ENUM("red", "blue"),
      allowNull: false,
    });
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_bets_method";',
    );
  },
};
