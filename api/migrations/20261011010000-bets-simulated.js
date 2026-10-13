// Spec 013 (R31): marca las apuestas generadas por el simulador de demo.
/** @type {import('sequelize-cli').Migration} */
export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("bets", "is_simulated", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("bets", "is_simulated");
  },
};
