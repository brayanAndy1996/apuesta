/** @type {import('sequelize-cli').Migration} */
export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("bets", "payout_centimos", {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn("bets", "paid_operation_number", {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addColumn("bets", "paid_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    // Ronda donde se registró la apuesta: el arrastre la cambia de round_id
    // pero conserva el origen para la contabilidad R26.
    await queryInterface.addColumn("bets", "origin_round_id", {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: "rounds", key: "id" },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("bets", "payout_centimos");
    await queryInterface.removeColumn("bets", "paid_operation_number");
    await queryInterface.removeColumn("bets", "paid_at");
    await queryInterface.removeColumn("bets", "origin_round_id");
  },
};
