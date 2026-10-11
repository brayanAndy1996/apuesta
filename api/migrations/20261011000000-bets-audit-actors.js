// Spec 012 (R23): auditoría — quién ejecutó cada acción que movió dinero.
/** @type {import('sequelize-cli').Migration} */
export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("bets", "annulled_by_id", {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await queryInterface.addColumn("bets", "refunded_by_id", {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await queryInterface.addColumn("bets", "paid_by_id", {
      type: Sequelize.UUID,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("bets", "annulled_by_id");
    await queryInterface.removeColumn("bets", "refunded_by_id");
    await queryInterface.removeColumn("bets", "paid_by_id");
  },
};
