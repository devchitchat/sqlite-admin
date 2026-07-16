export default async (robot) => {
	robot.commands.register({
		id: 'x:helo',
		description: 'Say helo',
		aliases: ['say helo'],
		handler: async (ctx) => {
      return "HELO World! I'm Dumbotheelephant."

		}
	})
}